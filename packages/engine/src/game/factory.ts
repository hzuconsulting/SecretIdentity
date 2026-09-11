import {
  DEFAULT_SETTINGS,
  generateUniqueGameCode,
  type Game,
  type Player,
  type PlayerId,
  type Rng,
  type Settings,
} from '@identite-secrete/shared';
import { createId, createSessionToken as newSessionToken } from '../random';

/**
 * Construction des objets de jeu.
 *
 * Tout ce qui est secret (`sessionToken`) est généré dans `random.ts`, avec
 * `crypto.getRandomValues` et non `Math.random` : un jeton devinable
 * permettrait d'usurper la session d'un autre joueur, donc de lire son
 * identité.
 */

export { createSessionToken } from '../random';

export function createPlayer(nickname: string, connectionId: string, now: number): Player {
  return {
    id: createId(),
    sessionToken: newSessionToken(),
    connectionId,
    nickname,
    score: 0,
    // La main n'est distribuée qu'au lancement : dans le salon, personne n'a
    // encore de cartes, et un joueur qui arrive en retard n'en aura jamais.
    hand: [],
    connected: true,
    disconnectedAt: null,
    joinedAt: now,
  };
}

export interface CreateGameArgs {
  host: Player;
  usedCodes: ReadonlySet<string>;
  rng: Rng;
  now: number;
  settings?: Settings;
  /**
   * Code imposé.
   *
   * En pair à pair, le code **est** l'identifiant que l'hôte réserve auprès du
   * service de signalisation : il doit donc être choisi, et accepté, avant que
   * la partie n'existe. Sans lui, on retombe sur un tirage local.
   */
  code?: string;
}

export function createGame({
  host,
  usedCodes,
  rng,
  now,
  settings,
  code,
}: CreateGameArgs): Game {
  return {
    code: code ?? generateUniqueGameCode(rng, usedCodes),
    hostId: host.id,
    phase: 'LOBBY',
    currentRound: 0,
    settings: { ...(settings ?? DEFAULT_SETTINGS) },
    players: new Map<PlayerId, Player>([[host.id, host]]),
    rounds: [],
    usedIdentityIds: new Set<string>(),
    bannedNicknames: new Set<string>(),
    createdAt: now,
    lastActivityAt: now,
    pausedAt: null,
  };
}

/** Joueurs dans l'ordre d'arrivée — l'ordre d'affichage du salon. */
export function playersInJoinOrder(game: Game): Player[] {
  return [...game.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

/** Pseudos déjà pris, en minuscules, pour la comparaison. */
export function takenNicknames(game: Game, exceptPlayerId?: PlayerId): Set<string> {
  const taken = new Set<string>();
  for (const player of game.players.values()) {
    if (player.id === exceptPlayerId) continue;
    taken.add(player.nickname.toLowerCase());
  }
  return taken;
}

export function touch(game: Game, now: number): void {
  game.lastActivityAt = now;
}
