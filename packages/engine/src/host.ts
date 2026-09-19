import {
  CLEANUP_INTERVAL_MS,
  GAME_TTL_MS,
  SERVER_EVENTS,
  fail,
  type Ack,
  type PlayerId,
  type RelaySnapshot,
  type Rng,
} from '@identite-secrete/shared';
import { logger } from './logger';
import { TimerRegistry, timerKeys } from './timers';
import { InMemoryStore } from './store/InMemoryStore';
import type { GameStore } from './store/GameStore';
import { GameEngine } from './game/engine';
import {
  ConnectionState,
  armAbsenceTimers,
  createHandlerContext,
  defaultHandlerConfig,
  eventHandlers,
  handleDisconnect,
  type HandlerDeps,
} from './handlers';
import { adoptRelaySnapshot, buildRelaySnapshot } from './serialization/relay';
import { SpectatorRegistry } from './spectators';
import { broadcastRelay, sendSpectatorViews } from './emit';
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

/**
 * Regroupement des vues envoyées aux écrans de suivi.
 *
 * Un changement de phase produit une rafale de diffusions — une par joueur —
 * qui aboutissent toutes au même état public. Sans ce délai, la télé recevrait
 * huit fois la même vue. Assez court pour que le décompte et les validations
 * paraissent instantanés à l'œil.
 */
const SPECTATOR_DEBOUNCE_MS = 250;

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

export interface AdoptOptions extends GameHostOptions {
  /**
   * Le joueur qui reprend l'hébergement.
   *
   * Sert à lui donner le salon si l'ancien hôte de salon est justement celui
   * qui a disparu — sinon la partie repartirait avec des boutons appartenant à
   * un fantôme, et plus personne ne pourrait avancer.
   */
  selfPlayerId?: PlayerId;
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

  /** Les écrans branchés sur une partie de ce nœud sans y jouer. */
  readonly spectators = new SpectatorRegistry();

  private spectatorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Compteur monotone des instantanés de reprise émis par ce nœud. */
  private relaySeq = 0;
  /** Empreintes de session, calculées une fois par joueur. */
  private readonly relayHashes = new Map<PlayerId, string>();

  constructor(options: GameHostOptions = {}) {
    const defaults = defaultHandlerConfig();

    this.options = options;
    this.emitListener = options.emit ?? (() => undefined);
    this.store = options.store ?? new InMemoryStore();
    this.timers = new TimerRegistry();

    const emitter: Emitter = {
      emit: (connectionId, event, payload) => {
        if (this.closed) return;
        // Toute vue joueur qui part signale un état public potentiellement
        // changé : c'est le seul point de passage commun à tout le moteur, donc
        // le seul endroit où accrocher les écrans de suivi sans disséminer un
        // appel dans chaque règle.
        if (event === SERVER_EVENTS.stateUpdate) this.scheduleSpectatorRefresh();
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
      spectators: this.spectators,
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

  /**
   * Reprend une partie à partir d'un instantané de relais.
   *
   * C'est le chemin de la migration : l'hôte a disparu, un autre joueur adopte
   * l'état qu'il avait reçu, et devient autoritaire à sa place.
   *
   * L'instantané doit avoir été **validé** avant d'arriver ici
   * (`parseRelaySnapshot`) : ce qui suit reconstruit, il ne contrôle plus.
   *
   * Trois choses se produisent, dans cet ordre, et l'ordre compte :
   *
   * 1. la partie est reconstruite avec tout le monde déconnecté — c'est exact,
   *    les canaux de l'ancien hôte n'existent plus ;
   * 2. elle est **mise en pause**, parce qu'il n'y a personne. C'est ce qui
   *    évite qu'un classement adopté n'enchaîne tout seul sur la manche
   *    suivante pendant que les joueurs se rebranchent encore ;
   * 3. les échéances d'absence sont armées. Les oublier laisserait des joueurs
   *    fantômes occuper un siège pour toujours, et surtout laisserait le salon
   *    à un disparu — ce qui bloque la partie pour de bon.
   *
   * La reprise proprement dite est ensuite du ressort de `rejoinGame` : quand
   * assez de monde est revenu, `resumeIfPossible` relance la phase avec une
   * échéance neuve.
   */
  static async adopt(snapshot: RelaySnapshot, options: AdoptOptions = {}): Promise<GameHost> {
    const defaults = defaultHandlerConfig();
    const now = Date.now();

    const game = adoptRelaySnapshot(snapshot, {
      rng: options.rng ?? defaults.rng,
      now,
      ...(options.selfPlayerId ? { selfPlayerId: options.selfPlayerId } : {}),
    });

    const store = options.store ?? new InMemoryStore();
    await store.create(game);

    const host = new GameHost({ ...options, store, fixedCode: game.code });

    // Personne n'est connecté : la pause s'impose d'elle-même, et elle arme au
    // passage l'échéance d'abandon qui évite une partie figée pour toujours.
    await host.engine.pauseIfNeeded(game);
    armAbsenceTimers(host.deps, game);

    logger.info(`Partie ${game.code} reprise (génération ${game.epoch})`);
    return host;
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

    const ack = await handler(createHandlerContext(state, this.deps), payload);
    // Filet : une action peut changer l'état public sans qu'aucune vue joueur
    // ne parte — le dernier joueur connecté qui valide et se déconnecte, par
    // exemple. L'écran de suivi ne doit pas rester figé pour autant.
    this.scheduleSpectatorRefresh();
    return ack;
  }

  /** Ferme une connexion : période de grâce, transfert d'hôte, pause éventuelle. */
  async disconnect(connectionId: ConnectionId, reason = 'transport close'): Promise<void> {
    const state = this.connections.get(connectionId);
    // Un écran de suivi n'a pas de joueur attaché : son canal se ferme sans
    // qu'aucun `ConnectionState` n'ait à exister. On le débranche d'abord,
    // avant tout retour anticipé.
    this.spectators.remove(connectionId);
    if (!state) return;

    this.connections.delete(connectionId);
    if (this.closed) return;

    await handleDisconnect(createHandlerContext(state, this.deps), reason);
    this.scheduleSpectatorRefresh();
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

    // Une échéance peut se déclencher alors que plus personne n'est connecté —
    // retrait après grâce, transfert d'hôte, mise en pause. Aucune vue joueur
    // ne part alors, et seul ce rattrapage tient la télé à jour.
    this.scheduleSpectatorRefresh();
  }

  /**
   * Diffuse à chaque invité l'instantané qui lui permettrait de reprendre la
   * partie, et son rang dans la file de succession.
   *
   * Retourne `null` si la partie n'existe pas ou si l'instantané n'a pas pu
   * être construit — `crypto.subtle` manque hors contexte sécurisé. Ce n'est
   * pas une panne de la partie : on perd seulement la possibilité qu'un autre
   * joueur la reprenne, et l'appelant décide s'il le signale.
   *
   * `excludeConnectionId` est le canal du joueur qui héberge. La file répond à
   * « qui reprend si **je** disparais » : s'y inclure soi-même n'aurait pas de
   * sens. Le moteur ne peut pas le deviner — `game.hostId` désigne l'hôte du
   * salon, pas celui du moteur — donc l'appelant le lui dit.
   */
  async relay(code: string, excludeConnectionId?: string): Promise<RelaySnapshot | null> {
    if (this.closed) return null;

    const game = await this.store.get(code);
    if (!game) return null;

    const snapshot = await buildRelaySnapshot(game, {
      epoch: game.epoch,
      seq: ++this.relaySeq,
      hashCache: this.relayHashes,
    });

    broadcastRelay(this.deps.emitter, game, snapshot, excludeConnectionId);
    return snapshot;
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
    if (this.spectatorTimer) clearTimeout(this.spectatorTimer);
    this.cleanupTimer = null;
    this.spectatorTimer = null;
    this.timers.clearAll();
    this.connections.clear();
    this.spectators.clear();
  }

  // ─────────────────────────────────────────────────────────
  //  Écrans de suivi
  // ─────────────────────────────────────────────────────────

  /**
   * Programme l'envoi d'une vue publique aux écrans branchés.
   *
   * Sans écran branché — le cas courant — l'appel ne coûte rien et ne programme
   * rien : c'est ce qui permet de l'accrocher aux chemins les plus passants du
   * nœud sans alourdir une partie ordinaire.
   */
  private scheduleSpectatorRefresh(): void {
    if (this.closed || this.spectatorTimer) return;
    if (this.spectators.size === 0) return;

    this.spectatorTimer = setTimeout(() => {
      this.spectatorTimer = null;
      void this.refreshSpectators();
    }, SPECTATOR_DEBOUNCE_MS);

    (this.spectatorTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Envoie la vue publique de chaque partie regardée — celles qui ont changé.
   *
   * La construction, la comparaison et l'envoi vivent dans `emit.ts`, avec le
   * reste de la diffusion : ce nœud ne décide que du **moment**.
   */
  private async refreshSpectators(now = Date.now()): Promise<void> {
    if (this.closed) return;

    for (const code of this.spectators.codes()) {
      const game = await this.store.get(code);
      if (game) sendSpectatorViews(this.deps.emitter, this.spectators, game, now);
    }
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
