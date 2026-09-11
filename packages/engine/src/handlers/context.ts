import {
  DISCONNECT_GRACE_MS,
  HOST_TRANSFER_DELAY_MS,
  defaultRng,
  fail,
  type Ack,
  type Game,
  type PlayerId,
  type Rng,
} from '@identite-secrete/shared';
import { logger } from '../logger';
import type { GameStore } from '../store/GameStore';
import type { GameEngine } from '../game/engine';
import { TimerRegistry, timerKeys } from '../timers';
import { broadcastState } from '../emit';
import { RateLimiter } from '../rateLimit';
import type { ConnectionId, Emitter } from '../transport';

/**
 * Socle commun des gestionnaires.
 *
 * Les événements sont répartis par domaine — session, manche — mais ils
 * partagent tous le même contexte : la connexion, ses dépendances, et quatre
 * utilitaires. Les faire circuler explicitement, plutôt que par fermeture dans
 * un fichier unique, garde chaque module lisible et rend visible ce dont il
 * dépend réellement.
 */

export interface HandlerDeps {
  emitter: Emitter;
  store: GameStore;
  timers: TimerRegistry;
  engine: GameEngine;
  rng: Rng;
  /** Plafond d'événements par fenêtre, injectable pour les tests. */
  rateLimitMaxEvents?: number;
  rateLimitWindowMs?: number;
  /** Délais rendus injectables pour que les tests n'attendent pas 60 s. */
  disconnectGraceMs: number;
  hostTransferDelayMs: number;
  /**
   * Code imposé à la partie créée sur ce nœud.
   *
   * En pair à pair, l'hôte réserve son identifiant auprès du service de
   * signalisation **avant** de créer la partie : le code ne peut donc pas être
   * tiré au sort à la création. Absent, on retombe sur un tirage local.
   */
  fixedCode?: string;
}

/** Signature commune à tous les gestionnaires d'événement client. */
export type EventHandler = (
  ctx: HandlerContext,
  payload: unknown,
) => Promise<Ack<unknown>>;

export function defaultHandlerConfig(): Pick<
  HandlerDeps,
  'rng' | 'disconnectGraceMs' | 'hostTransferDelayMs'
> {
  return {
    rng: defaultRng,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
    hostTransferDelayMs: HOST_TRANSFER_DELAY_MS,
  };
}

/** Ce qu'une connexion sait d'elle-même. Rien de secret : juste de quoi retrouver l'état. */
export interface Binding {
  code: string;
  playerId: PlayerId;
}

/**
 * État attaché à une connexion vivante.
 *
 * Il vit dans le `GameHost`, pas dans le contexte : le contexte est reconstruit
 * à chaque message reçu, alors que la limitation de débit et l'attachement,
 * eux, doivent survivre d'un message au suivant.
 */
export class ConnectionState {
  binding: Binding | null = null;
  readonly limiter: RateLimiter;

  constructor(
    readonly id: ConnectionId,
    maxEvents?: number,
    windowMs?: number,
  ) {
    this.limiter = new RateLimiter(maxEvents, windowMs);
  }
}

export interface HandlerContext {
  connectionId: ConnectionId;
  deps: HandlerDeps;
  /**
   * Enveloppe de tous les gestionnaires : limitation de débit, exécution, et
   * récupération d'erreur. Aucun `catch` silencieux — une exception inattendue
   * est journalisée et renvoyée en erreur typée, jamais avalée.
   */
  guard<T>(label: string, run: () => Promise<Ack<T>>): Promise<Ack<T>>;
  /** Attache la connexion à un joueur d'une partie. */
  bind(code: string, playerId: PlayerId): void;
  /** Détache la connexion, après un départ volontaire. */
  unbind(): void;
  /** Retrouve la partie et le joueur attachés à cette connexion. */
  resolveContext(): Promise<{ game: Game; playerId: PlayerId } | null>;
  /** Sauvegarde, ou supprime la partie si elle est vide. */
  finalize(game: Game, now: number): Promise<void>;
}

export function createHandlerContext(
  state: ConnectionState,
  deps: HandlerDeps,
): HandlerContext {
  const { store } = deps;

  return {
    connectionId: state.id,
    deps,

    async guard<T>(label: string, run: () => Promise<Ack<T>>): Promise<Ack<T>> {
      if (!state.limiter.accept()) {
        logger.warn(`Débit dépassé sur ${label} (connexion ${state.id})`);
        return fail<T>('RATE_LIMITED');
      }

      try {
        return await run();
      } catch (error) {
        logger.error(`Échec de ${label}`, error);
        return fail<T>('INTERNAL_ERROR');
      }
    },

    bind(code: string, playerId: PlayerId): void {
      state.binding = { code, playerId };
    },

    unbind(): void {
      state.binding = null;
    },

    async resolveContext() {
      const binding = state.binding;
      if (!binding) return null;

      const game = await store.get(binding.code);
      if (!game || !game.players.has(binding.playerId)) return null;

      return { game, playerId: binding.playerId };
    },

    finalize: (game: Game, now: number) => finalizeGame(deps, game, now),
  };
}

/**
 * Sauvegarde, ou supprime la partie si elle est vide.
 *
 * Fonction libre, et pas seulement une méthode du contexte : les échéances
 * (retrait après grâce, transfert d'hôte) doivent pouvoir l'appeler alors
 * qu'aucune connexion n'est en jeu — c'est le cas après une reprise
 * d'hébergement, où les minuteurs sont armés sans que personne n'ait encore
 * envoyé quoi que ce soit.
 */
export async function finalizeGame(deps: HandlerDeps, game: Game, now: number): Promise<void> {
  const { emitter, store, timers } = deps;

  if (game.players.size === 0) {
    deps.engine.cancel(game.code);
    timers.cancelByPrefix(timerKeys.gamePrefix(game.code));
    await store.delete(game.code);
    logger.info(`Partie ${game.code} supprimée (plus aucun joueur)`);
    return;
  }

  await store.save(game);
  broadcastState(emitter, game, now);
}
