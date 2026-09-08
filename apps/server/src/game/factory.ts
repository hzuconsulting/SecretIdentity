import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_SETTINGS,
  generateUniqueGameCode,
  type Game,
  type Player,
  type PlayerId,
  type Rng,
  type Settings,
} from '@identite-secrete/shared';

/**
 * Construction des objets de jeu.
 *
 * Tout ce qui est secret (`sessionToken`) est généré ici, avec
 * `crypto.randomBytes` et non `Math.random` : un jeton devinable permettrait
 * d'usurper la session d'un autre joueur, donc de lire son identité.
 */

export function createSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

export function createPlayer(nickname: string, socketId: string, now: number): Player {
  return {
    id: randomUUID(),
    sessionToken: createSessionToken(),
    socketId,
    nickname,
    score: 0,
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
}

export function createGame({
  host,
  usedCodes,
  rng,
  now,
  settings,
}: CreateGameArgs): Game {
  return {
    code: generateUniqueGameCode(rng, usedCodes),
    hostId: host.id,
    phase: 'LOBBY',
    currentRound: 0,
    settings: { ...(settings ?? DEFAULT_SETTINGS) },
    players: new Map<PlayerId, Player>([[host.id, host]]),
    rounds: [],
    usedIdentityIds: new Set<string>(),
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
