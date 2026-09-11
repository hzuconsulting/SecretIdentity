import { z } from 'zod';
import {
  BOARD_SIZE,
  CODE_LENGTH,
  DIFFICULTY_OPTIONS,
  MAX_NICKNAME_LENGTH,
  MAX_PICTOS,
  MIN_NICKNAME_LENGTH,
  MIN_PICTOS,
  STARTING_HAND_CARDS,
  TIMER_OPTIONS,
} from './constants';
import { normalizeGameCode } from './gameCode';
import type { Ack, GameError, GameErrorCode, PlayerView, Phase } from './types';

// ─────────────────────────────────────────────────────────────
//  Noms d'événements (jamais de chaîne magique ailleurs)
// ─────────────────────────────────────────────────────────────

export const CLIENT_EVENTS = {
  createGame: 'game:create',
  joinGame: 'game:join',
  rejoinGame: 'game:rejoin',
  updateSettings: 'settings:update',
  startGame: 'game:start',
  submitClues: 'clues:submit',
  submitGuesses: 'guesses:submit',
  nextRound: 'round:next',
  replay: 'game:replay',
  leave: 'game:leave',
  kickPlayer: 'player:kick',
  ping: 'time:ping',
} as const;

export const SERVER_EVENTS = {
  /** Vue joueur complète — la seule source de vérité côté client. */
  stateUpdate: 'state:update',
  phaseChanged: 'phase:changed',
  error: 'game:error',
  toast: 'game:toast',
  /** Envoyé au seul joueur exclu, juste avant son retrait. */
  kicked: 'game:kicked',
} as const;

// ─────────────────────────────────────────────────────────────
//  Schémas Zod — validation de TOUS les payloads entrants
// ─────────────────────────────────────────────────────────────

export const nicknameSchema = z
  .string()
  .trim()
  .min(MIN_NICKNAME_LENGTH, 'Choisis un pseudo.')
  .max(MAX_NICKNAME_LENGTH, `${MAX_NICKNAME_LENGTH} caractères maximum.`);

export const gameCodeSchema = z
  .string()
  .transform(normalizeGameCode)
  .refine((code) => code.length === CODE_LENGTH, 'Un code contient 5 caractères.');

export const createGameSchema = z.object({
  nickname: nicknameSchema,
});

export const joinGameSchema = z.object({
  code: gameCodeSchema,
  nickname: nicknameSchema,
});

export const rejoinGameSchema = z.object({
  sessionToken: z.string().min(10).max(200),
});

const timerSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
  z.null(),
]);

export const settingsSchema = z.object({
  clueSeconds: timerSchema,
  guessSeconds: timerSchema,
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
});

export const updateSettingsSchema = settingsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  'Aucun paramètre à modifier.',
);

export const startGameSchema = z.object({});

/** Un pictogramme posé : quelle carte, quelle face, quelle zone. */
export const placedPictoSchema = z.object({
  cardId: z.string().min(1).max(64),
  iconId: z.string().min(1).max(64),
  zone: z.enum(['green', 'red']),
});

/**
 * Le plafond Zod est volontairement plus large que la règle : c'est
 * `validatePlacement` qui refuse au-delà de `MAX_PICTOS`, avec un message
 * français utile. Zod ne borne ici que l'absurde.
 */
export const submitCluesSchema = z.object({
  placed: z.array(placedPictoSchema).min(MIN_PICTOS).max(STARTING_HAND_CARDS),
});

/** Vote : adversaire → numéro du plateau. */
export const submitGuessesSchema = z.object({
  votes: z.record(z.string().min(1).max(64), z.number().int().min(1).max(BOARD_SIZE)),
});

export const kickPlayerSchema = z.object({
  playerId: z.string().min(1).max(64),
});

export const nextRoundSchema = z.object({});
export const replaySchema = z.object({});
export const pingSchema = z.object({ clientTime: z.number() });

export type CreateGamePayload = z.infer<typeof createGameSchema>;
export type JoinGamePayload = z.infer<typeof joinGameSchema>;
export type RejoinGamePayload = z.infer<typeof rejoinGameSchema>;
export type UpdateSettingsPayload = z.infer<typeof updateSettingsSchema>;
export type SubmitCluesPayload = z.infer<typeof submitCluesSchema>;
export type SubmitGuessesPayload = z.infer<typeof submitGuessesSchema>;
export type KickPlayerPayload = z.infer<typeof kickPlayerSchema>;
export type PingPayload = z.infer<typeof pingSchema>;

/** Sanity check : les options du salon et les schémas Zod ne divergent pas. */
export const SETTINGS_OPTIONS = {
  clueSeconds: TIMER_OPTIONS,
  guessSeconds: TIMER_OPTIONS,
  difficulty: DIFFICULTY_OPTIONS,
} as const;

// ─────────────────────────────────────────────────────────────
//  Payloads serveur → client
// ─────────────────────────────────────────────────────────────

export interface SessionPayload {
  sessionToken: string;
  playerId: string;
  code: string;
}

export interface PhaseChangedPayload {
  phase: Phase;
  roundNumber: number;
  phaseEndsAt: number | null;
  serverTime: number;
}

export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

export interface ToastPayload {
  message: string;
  tone: 'info' | 'success' | 'warning';
}

export type StateUpdatePayload = PlayerView;

// ─────────────────────────────────────────────────────────────
//  Erreurs
// ─────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<GameErrorCode, string> = {
  GAME_NOT_FOUND: "Ce code ne correspond à aucune partie.",
  GAME_ALREADY_STARTED: 'Cette partie a déjà commencé.',
  GAME_FULL: 'Ce salon est complet.',
  NICKNAME_TAKEN: 'Ce pseudo est déjà pris dans ce salon.',
  INVALID_NICKNAME: 'Ce pseudo ne convient pas.',
  INVALID_CODE: 'Ce code est invalide.',
  NOT_HOST: "Seul l'hôte peut faire ça.",
  WRONG_PHASE: "Ce n'est pas le moment de faire ça.",
  NOT_ENOUGH_PLAYERS: 'Il faut au moins 3 joueurs pour lancer.',
  INVALID_PAYLOAD: 'Requête invalide.',
  CARD_NOT_IN_HAND: "Cette carte n'est pas dans ta main.",
  TOO_MANY_CLUES: `Tu ne peux poser que ${MAX_PICTOS} pictogrammes.`,
  NOT_ENOUGH_CLUES: 'Pose au moins un pictogramme.',
  INVALID_GUESS: 'Ces votes ne sont pas valides.',
  TOO_LATE: 'Trop tard !',
  SESSION_NOT_FOUND: 'Ta session a expiré.',
  RATE_LIMITED: 'Trop d’actions d’un coup. Attends une seconde.',
  GAME_PAUSED: 'La partie est en pause, il n’y a plus assez de joueurs.',
  KICKED: 'Tu as été exclu·e de cette partie par l’hôte.',
  INTERNAL_ERROR: 'Une erreur est survenue.',
};

export function gameError(
  code: GameErrorCode,
  overrides?: Partial<Omit<GameError, 'code'>>,
): GameError {
  return {
    code,
    message: overrides?.message ?? ERROR_MESSAGES[code],
    ...(overrides?.suggestion ? { suggestion: overrides.suggestion } : {}),
  };
}

export function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: GameErrorCode,
  overrides?: Partial<Omit<GameError, 'code'>>,
): Ack<T> {
  return { ok: false, error: gameError(code, overrides) };
}
