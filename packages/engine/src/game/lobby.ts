import {
  MAX_PLAYERS,
  suggestNickname,
  type Game,
  type Player,
  type PlayerId,
} from '@identite-secrete/shared';
import { playersInJoinOrder, takenNicknames, touch } from './factory';

/**
 * Règles du salon.
 *
 * Fonctions volontairement sans dépendance à Socket.IO : elles décrivent ce
 * qui arrive à un `Game`, pas comment on le diffuse. C'est ce qui permet de
 * les tester sans réseau, et de les réutiliser au Lot 5 quand une partie en
 * cours devra gérer les mêmes cas.
 */

export type JoinRejection =
  | { reason: 'GAME_ALREADY_STARTED' }
  | { reason: 'GAME_FULL' }
  | { reason: 'KICKED' }
  | { reason: 'NICKNAME_TAKEN'; suggestion: string };

/**
 * Vérifie qu'un joueur peut rejoindre. Retourne `null` si c'est bon.
 * L'ordre des contrôles est celui du §4.3 : exclusion, partie commencée, salon
 * plein, puis pseudo — le message le plus utile en premier.
 *
 * Le contrôle d'exclusion passe en premier pour que la réponse soit franche :
 * un exclu doit lire « tu as été exclu », pas « ce pseudo est pris ».
 */
export function checkCanJoin(game: Game, nickname: string): JoinRejection | null {
  if (game.bannedNicknames.has(nickname.toLowerCase())) {
    return { reason: 'KICKED' };
  }

  if (game.phase !== 'LOBBY') {
    return { reason: 'GAME_ALREADY_STARTED' };
  }

  if (game.players.size >= MAX_PLAYERS) {
    return { reason: 'GAME_FULL' };
  }

  const taken = takenNicknames(game);
  if (taken.has(nickname.toLowerCase())) {
    return { reason: 'NICKNAME_TAKEN', suggestion: suggestNickname(nickname, taken) };
  }

  return null;
}

/**
 * Bannit le pseudo d'un joueur exclu, pour qu'il ne revienne pas aussitôt.
 *
 * C'est tout ce qu'on peut faire en pair à pair : sans serveur ni compte, il
 * n'existe aucune identité d'appareil, et rien n'empêche un exclu de revenir
 * sous un autre pseudo. Limite assumée — l'exclusion règle le cas du joueur
 * gênant, pas celui de l'acharné.
 */
export function banNickname(game: Game, player: Player): void {
  game.bannedNicknames.add(player.nickname.toLowerCase());
}

export function addPlayer(game: Game, player: Player, now: number): void {
  game.players.set(player.id, player);
  touch(game, now);
}

/** Retire définitivement un joueur. Retourne `true` s'il était présent. */
export function removePlayer(game: Game, playerId: PlayerId, now: number): boolean {
  const removed = game.players.delete(playerId);
  if (removed) touch(game, now);
  return removed;
}

export function markDisconnected(game: Game, playerId: PlayerId, now: number): void {
  const player = game.players.get(playerId);
  if (!player) return;

  player.connected = false;
  player.disconnectedAt = now;
  player.connectionId = null;
  touch(game, now);
}

export function markReconnected(
  game: Game,
  playerId: PlayerId,
  connectionId: string,
  now: number,
): void {
  const player = game.players.get(playerId);
  if (!player) return;

  player.connected = true;
  player.disconnectedAt = null;
  player.connectionId = connectionId;
  touch(game, now);
}

/**
 * Le successeur légitime : le joueur **connecté** le plus ancien (§9).
 * Retourne `null` si plus personne n'est connecté — dans ce cas on ne
 * transfère rien, la partie sera purgée ou reprise par un revenant.
 */
export function nextHostCandidate(game: Game): Player | null {
  const candidates = playersInJoinOrder(game).filter(
    (player) => player.connected && player.id !== game.hostId,
  );
  return candidates[0] ?? null;
}

export interface HostTransfer {
  newHostId: PlayerId;
  newHostNickname: string;
  previousHostNickname: string;
}

/** Transfère le rôle d'hôte si un successeur existe. */
export function transferHost(game: Game, now: number): HostTransfer | null {
  const successor = nextHostCandidate(game);
  if (!successor) return null;

  const previous = game.players.get(game.hostId);
  game.hostId = successor.id;
  touch(game, now);

  return {
    newHostId: successor.id,
    newHostNickname: successor.nickname,
    previousHostNickname: previous?.nickname ?? 'L’hôte',
  };
}

export function connectedCount(game: Game): number {
  let count = 0;
  for (const player of game.players.values()) {
    if (player.connected) count += 1;
  }
  return count;
}

export function isHost(game: Game, playerId: PlayerId): boolean {
  return game.hostId === playerId;
}
