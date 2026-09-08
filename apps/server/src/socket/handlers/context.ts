import type { Server, Socket } from 'socket.io';
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
import { logger } from '../../logger';
import type { GameStore } from '../../store/GameStore';
import type { GameEngine } from '../../game/engine';
import { TimerRegistry, timerKeys } from '../../game/timers';
import { broadcastState } from '../emit';
import { RateLimiter } from '../rateLimit';

/**
 * Socle commun des gestionnaires.
 *
 * Les événements sont répartis en trois modules par domaine — session, salon,
 * manche — mais ils partagent tous le même contexte : la socket, ses
 * dépendances, et quatre utilitaires. Les faire circuler explicitement, plutôt
 * que par fermeture dans un fichier unique, garde chaque module lisible et
 * rend visible ce dont il dépend réellement.
 */

export interface HandlerDeps {
  io: Server;
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
}

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

/** Ce qu'une socket sait d'elle-même. Rien de secret : juste de quoi retrouver l'état. */
interface SocketBinding {
  code: string;
  playerId: PlayerId;
}

const bindings = new WeakMap<Socket, SocketBinding>();

export interface HandlerContext {
  socket: Socket;
  deps: HandlerDeps;
  /**
   * Enveloppe de tous les gestionnaires : limitation de débit, exécution, et
   * récupération d'erreur. Aucun `catch` silencieux — une exception inattendue
   * est journalisée et renvoyée en erreur typée, jamais avalée.
   */
  guard<T>(ack: unknown, label: string, run: () => Promise<Ack<T>>): Promise<void>;
  /** Attache la socket à un joueur d'une partie. */
  bind(code: string, playerId: PlayerId): void;
  /** Détache la socket, après un départ volontaire. */
  unbind(): void;
  /** Retrouve la partie et le joueur attachés à cette socket. */
  resolveContext(): Promise<{ game: Game; playerId: PlayerId } | null>;
  /** Sauvegarde, ou supprime la partie si elle est vide. */
  finalize(game: Game, now: number): Promise<void>;
}

export function createHandlerContext(socket: Socket, deps: HandlerDeps): HandlerContext {
  const { io, store, timers } = deps;
  const rateLimiter = new RateLimiter(deps.rateLimitMaxEvents, deps.rateLimitWindowMs);

  function respond<T>(ack: unknown, value: Ack<T>): void {
    if (typeof ack === 'function') (ack as (r: Ack<T>) => void)(value);
  }

  return {
    socket,
    deps,

    async guard<T>(ack: unknown, label: string, run: () => Promise<Ack<T>>): Promise<void> {
      if (!rateLimiter.accept()) {
        logger.warn(`Débit dépassé sur ${label} (socket ${socket.id})`);
        respond(ack, fail<T>('RATE_LIMITED'));
        return;
      }

      try {
        respond(ack, await run());
      } catch (error) {
        logger.error(`Échec de ${label}`, error);
        respond(ack, fail<T>('INTERNAL_ERROR'));
      }
    },

    bind(code: string, playerId: PlayerId): void {
      bindings.set(socket, { code, playerId });
      void socket.join(code);
    },

    unbind(): void {
      bindings.delete(socket);
    },

    async resolveContext() {
      const binding = bindings.get(socket);
      if (!binding) return null;

      const game = await store.get(binding.code);
      if (!game || !game.players.has(binding.playerId)) return null;

      return { game, playerId: binding.playerId };
    },

    async finalize(game: Game, now: number): Promise<void> {
      if (game.players.size === 0) {
        deps.engine.cancel(game.code);
        timers.cancelByPrefix(timerKeys.gamePrefix(game.code));
        await store.delete(game.code);
        logger.info(`Partie ${game.code} supprimée (plus aucun joueur)`);
        return;
      }

      await store.save(game);
      broadcastState(io, game, now);
    },
  };
}
