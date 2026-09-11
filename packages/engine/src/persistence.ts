import type {
  Game,
  IdentityId,
  Phase,
  Player,
  PlayerId,
  PlayerRound,
  Round,
  Settings,
} from '@identite-secrete/shared';
import { PHASES } from '@identite-secrete/shared';

/**
 * Sérialisation d'une partie.
 *
 * Nécessaire uniquement depuis que le moteur vit dans un onglet : un
 * rafraîchissement, un retour depuis l'écran d'accueil, ou un onglet recyclé
 * par iOS effacent la mémoire du nœud hôte. Sans cette sauvegarde, une partie
 * de quatre manches disparaîtrait au premier geste malheureux de l'hôte.
 *
 * `Game` contient des `Map` et des `Set`, que `JSON.stringify` transforme
 * silencieusement en `{}` : c'est précisément le genre de perte muette qu'on
 * évite en écrivant la conversion à la main plutôt qu'en sérialisant l'objet
 * tel quel.
 *
 * Ce qui est écrit **contient les numéros secrets et les mains**. C'est
 * acceptable, et seulement parce que le stockage est celui de l'hôte, sur son
 * propre appareil, et qu'il détient déjà l'état complet en mémoire. Rien de tout
 * cela ne part sur le réseau : c'est `serialization/playerView.ts` qui décide de
 * ce qui sort.
 */

/**
 * Version 2 : plateau de huit personnages, numéros secrets, mains persistantes.
 *
 * Une sauvegarde de version 1 décrivait un jeu qui n'existe plus (une identité
 * par joueur, une main par manche, des étiquettes anonymes). On la **refuse**
 * plutôt que de tenter une migration : l'hôte repart du salon, ce qui est bien
 * préférable à une partie à moitié convertie.
 */
export const PERSISTENCE_VERSION = 2;

export interface SerializedGame {
  version: typeof PERSISTENCE_VERSION;
  code: string;
  hostId: PlayerId;
  phase: Phase;
  currentRound: number;
  settings: Settings;
  players: Player[];
  rounds: Array<Omit<Round, 'assignments'> & {
    assignments: Array<[PlayerId, PlayerRound]>;
  }>;
  usedIdentityIds: string[];
  bannedNicknames: string[];
  createdAt: number;
  lastActivityAt: number;
  pausedAt: number | null;
}

export function serializeGame(game: Game): SerializedGame {
  return {
    version: PERSISTENCE_VERSION,
    code: game.code,
    hostId: game.hostId,
    phase: game.phase,
    currentRound: game.currentRound,
    settings: { ...game.settings },
    players: [...game.players.values()].map((player) => ({
      ...player,
      hand: player.hand.map((card) => ({ ...card })),
    })),
    rounds: game.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      phase: round.phase,
      phaseEndsAt: round.phaseEndsAt,
      board: [...round.board],
      assignments: [...round.assignments.entries()].map(([playerId, assignment]) => [
        playerId,
        {
          ...assignment,
          placed: assignment.placed.map((picto) => ({ ...picto })),
          votes: { ...assignment.votes },
        },
      ]),
    })),
    usedIdentityIds: [...game.usedIdentityIds],
    bannedNicknames: [...game.bannedNicknames],
    createdAt: game.createdAt,
    lastActivityAt: game.lastActivityAt,
    pausedAt: game.pausedAt,
  };
}

/**
 * Reconstruit une partie. Retourne `null` si l'entrée ne ressemble pas à une
 * partie — un stockage corrompu, ou écrit par une version antérieure, doit
 * renvoyer l'hôte au salon, pas faire planter la page.
 *
 * Tous les joueurs reviennent **déconnectés** : leurs canaux WebRTC n'existent
 * plus. Ils repasseront à `connected` en se reconnectant avec leur jeton de
 * session, qui est conservé — et leur main avec.
 */
export function deserializeGame(raw: unknown): Game | null {
  if (!isRecord(raw) || raw.version !== PERSISTENCE_VERSION) return null;

  const code = raw.code;
  const hostId = raw.hostId;
  if (typeof code !== 'string' || typeof hostId !== 'string') return null;
  if (!isPhase(raw.phase)) return null;
  if (!Array.isArray(raw.players) || raw.players.length === 0) return null;
  if (!isRecord(raw.settings)) return null;

  const players = new Map<PlayerId, Player>();
  for (const entry of raw.players) {
    if (!isRecord(entry) || typeof entry.id !== 'string') return null;
    players.set(entry.id, {
      ...(entry as unknown as Player),
      hand: Array.isArray(entry.hand) ? (entry.hand as Player['hand']) : [],
      connected: false,
      connectionId: null,
      disconnectedAt: typeof entry.disconnectedAt === 'number' ? entry.disconnectedAt : Date.now(),
    });
  }

  const rounds: Round[] = [];
  for (const entry of Array.isArray(raw.rounds) ? raw.rounds : []) {
    if (!isRecord(entry)) return null;
    if (!isPhase(entry.phase) || !Array.isArray(entry.board)) return null;

    const assignments = new Map<PlayerId, PlayerRound>();
    for (const pair of Array.isArray(entry.assignments) ? entry.assignments : []) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !isRecord(pair[1])) return null;
      assignments.set(pair[0], pair[1] as unknown as PlayerRound);
    }

    rounds.push({
      roundNumber: Number(entry.roundNumber) || 0,
      phase: entry.phase,
      phaseEndsAt: typeof entry.phaseEndsAt === 'number' ? entry.phaseEndsAt : null,
      board: entry.board.filter((id): id is IdentityId => typeof id === 'string'),
      assignments,
    });
  }

  return {
    code,
    hostId,
    phase: raw.phase,
    currentRound: Number(raw.currentRound) || 0,
    settings: raw.settings as unknown as Settings,
    players,
    rounds,
    usedIdentityIds: new Set(toStringArray(raw.usedIdentityIds)),
    bannedNicknames: new Set(toStringArray(raw.bannedNicknames)),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    lastActivityAt: typeof raw.lastActivityAt === 'number' ? raw.lastActivityAt : Date.now(),
    pausedAt: typeof raw.pausedAt === 'number' ? raw.pausedAt : null,
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPhase(value: unknown): value is Phase {
  return typeof value === 'string' && (PHASES as readonly string[]).includes(value);
}
