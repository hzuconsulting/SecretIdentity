import {
  CLEANUP_INTERVAL_MS,
  GAME_TTL_MS,
  fail,
  type Ack,
  type Rng,
} from '@identite-secrete/shared';
import { logger } from './logger';
import { TimerRegistry, timerKeys } from './timers';
import { InMemoryStore } from './store/InMemoryStore';
import type { GameStore } from './store/GameStore';
import { GameEngine } from './game/engine';
import {
  ConnectionState,
  createHandlerContext,
  defaultHandlerConfig,
  eventHandlers,
  handleDisconnect,
  type HandlerDeps,
} from './handlers';
import type { ConnectionId, Emitter } from './transport';

/**
 * Le nœud autoritaire d'une partie.
 *
 * C'est l'ancien `apps/server`, moins le réseau. Il ne sait ni ouvrir un port,
 * ni parler WebRTC : il reçoit des messages étiquetés par une connexion et
 * répond, ce qui le rend indifférent au transport qui l'alimente. Dans le jeu
 * déployé, il tourne **dans le navigateur du joueur qui crée la partie** ; dans
 * les tests, dans un simple objet en mémoire.
 *
 * Ce que ça ne change pas : il reste la seule source de vérité. Les messages
 * qu'il reçoit viennent de navigateurs qu'il ne contrôle pas, donc tout est
 * validé, et chaque joueur ne reçoit que la vue calculée pour lui.
 */

export type EmitListener = (
  connectionId: ConnectionId,
  event: string,
  payload: unknown,
) => void;

export interface GameHostOptions {
  /** Où partent les messages sortants. Absent, ils sont silencieusement perdus. */
  emit?: EmitListener;
  store?: GameStore;
  rng?: Rng;
  disconnectGraceMs?: number;
  hostTransferDelayMs?: number;
  rateLimitMaxEvents?: number;
  rateLimitWindowMs?: number;
  /** Facteur appliqué aux durées de phase. 1 en production, 0,01 dans les tests. */
  timeScale?: number;
  /** `false` dans les tests : pas besoin d'une boucle de purge. */
  enableCleanup?: boolean;
  /**
   * Code imposé à la partie créée sur ce nœud.
   *
   * En pair à pair, l'hôte réserve son identifiant de signalisation avant de
   * créer la partie : le code est donc décidé au-dehors.
   */
  fixedCode?: string;
}

export class GameHost {
  readonly store: GameStore;
  readonly timers: TimerRegistry;
  readonly engine: GameEngine;

  private readonly connections = new Map<ConnectionId, ConnectionState>();
  private readonly deps: HandlerDeps;
  private readonly options: GameHostOptions;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private emitListener: EmitListener;
  private closed = false;

  constructor(options: GameHostOptions = {}) {
    const defaults = defaultHandlerConfig();

    this.options = options;
    this.emitListener = options.emit ?? (() => undefined);
    this.store = options.store ?? new InMemoryStore();
    this.timers = new TimerRegistry();

    const emitter: Emitter = {
      emit: (connectionId, event, payload) => {
        if (this.closed) return;
        this.emitListener(connectionId, event, payload);
      },
    };

    this.engine = new GameEngine({
      emitter,
      store: this.store,
      timers: this.timers,
      rng: options.rng ?? defaults.rng,
      timeScale: options.timeScale ?? 1,
    });

    this.deps = {
      emitter,
      store: this.store,
      timers: this.timers,
      engine: this.engine,
      rng: options.rng ?? defaults.rng,
      disconnectGraceMs: options.disconnectGraceMs ?? defaults.disconnectGraceMs,
      hostTransferDelayMs: options.hostTransferDelayMs ?? defaults.hostTransferDelayMs,
      ...(options.rateLimitMaxEvents !== undefined
        ? { rateLimitMaxEvents: options.rateLimitMaxEvents }
        : {}),
      ...(options.rateLimitWindowMs !== undefined
        ? { rateLimitWindowMs: options.rateLimitWindowMs }
        : {}),
      ...(options.fixedCode ? { fixedCode: options.fixedCode } : {}),
    };

    if (options.enableCleanup !== false) this.startCleanup();
  }

  /** Redirige les messages sortants. Utile quand le transport est branché après coup. */
  setEmitListener(listener: EmitListener): void {
    this.emitListener = listener;
  }

  /** Déclare une nouvelle connexion entrante. Idempotent. */
  connect(connectionId: ConnectionId): void {
    if (this.connections.has(connectionId)) return;

    this.connections.set(
      connectionId,
      new ConnectionState(
        connectionId,
        this.options.rateLimitMaxEvents,
        this.options.rateLimitWindowMs,
      ),
    );
    logger.debug(`Connexion ${connectionId}`);
  }

  /**
   * Traite un message client et retourne son acquittement.
   *
   * Chaque message est aussi l'occasion de rattraper une échéance manquée :
   * dans un navigateur mis en veille, c'est souvent le seul réveil disponible.
   */
  async dispatch(
    connectionId: ConnectionId,
    event: string,
    payload: unknown,
  ): Promise<Ack<unknown>> {
    if (this.closed) return fail('INTERNAL_ERROR');

    this.connect(connectionId);
    const state = this.connections.get(connectionId);
    if (!state) return fail('INTERNAL_ERROR');

    await this.tickAll();

    const handler = eventHandlers[event];
    if (!handler) {
      logger.warn(`Événement inconnu rejeté : ${event}`);
      return fail('INVALID_PAYLOAD', { message: 'Action inconnue.' });
    }

    return handler(createHandlerContext(state, this.deps), payload);
  }

  /** Ferme une connexion : période de grâce, transfert d'hôte, pause éventuelle. */
  async disconnect(connectionId: ConnectionId, reason = 'transport close'): Promise<void> {
    const state = this.connections.get(connectionId);
    if (!state) return;

    this.connections.delete(connectionId);
    if (this.closed) return;

    await handleDisconnect(createHandlerContext(state, this.deps), reason);
  }

  /**
   * Rattrape les échéances de phase dépassées, sur toutes les parties du nœud.
   *
   * Un onglet en arrière-plan voit ses minuteurs étalés ou gelés : sans ce
   * rattrapage, l'hôte qui verrouille son téléphone rendrait la main sur une
   * manche figée. Appelée à chaque message reçu, et par le nœud client au
   * retour au premier plan.
   */
  async tickAll(now = Date.now()): Promise<void> {
    if (this.closed) return;

    for (const code of await this.store.usedCodes()) {
      const game = await this.store.get(code);
      if (game) await this.engine.tick(game, now);
    }
  }

  /** Nombre de parties détenues par ce nœud. Sert au diagnostic. */
  count(): Promise<number> {
    return this.store.count();
  }

  /** Arrête tous les minuteurs. Le nœud ne répond plus après cet appel. */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.timers.clearAll();
    this.connections.clear();
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      void this.store.purgeInactive(GAME_TTL_MS, Date.now()).then((codes) => {
        for (const code of codes) this.timers.cancelByPrefix(timerKeys.gamePrefix(code));
        if (codes.length > 0) logger.info(`Parties purgées : ${codes.join(', ')}`);
      });
    }, CLEANUP_INTERVAL_MS);

    (this.cleanupTimer as { unref?: () => void }).unref?.();
  }
}
