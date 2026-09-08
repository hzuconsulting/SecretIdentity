/**
 * Types partagés client / serveur.
 * Aucune dépendance à Socket.IO ni à React ici : ce fichier doit rester
 * importable depuis n'importe quel environnement.
 */

// ─────────────────────────────────────────────────────────────
//  Identifiants
// ─────────────────────────────────────────────────────────────

export type PlayerId = string;

/** Étiquette anonyme d'une série d'indices : 'A', 'B', 'C'… */
export type Label = string;

/** Identifiant d'une identité ("harry-potter"). */
export type IdentityId = string;

/** Identifiant d'une icône ("lightning"). */
export type IconId = string;

// ─────────────────────────────────────────────────────────────
//  Données statiques
// ─────────────────────────────────────────────────────────────

export type IdentityCategory =
  | 'disney'
  | 'animation'
  | 'superhero'
  | 'cinema'
  | 'serie'
  | 'jeuvideo'
  | 'celebrite'
  | 'sport'
  | 'musique'
  | 'histoire'
  | 'fiction';

export type IdentityDifficulty = 'easy' | 'medium' | 'hard';

export interface Identity {
  id: IdentityId;
  name: string;
  category: IdentityCategory;
  difficulty: IdentityDifficulty;
  /**
   * Packs auxquels appartient cette identité. `base` est toujours présent.
   * Prévu pour « Pack Disney », « Pack Enfants »… sans refactor (cf. §8.1).
   */
  packs?: string[];
}

export type IconCategory =
  | 'objet'
  | 'animal'
  | 'nourriture'
  | 'lieu'
  | 'symbole'
  | 'action'
  | 'nature'
  | 'personne';

export interface GameIcon {
  id: IconId;
  /** Emoji Unicode. */
  icon: string;
  /** Libellé français, utilisé aussi comme `aria-label`. */
  label: string;
  category: IconCategory;
  keywords: string[];
}

// ─────────────────────────────────────────────────────────────
//  Paramètres de partie
// ─────────────────────────────────────────────────────────────

/** `null` signifie « pas de limite de temps » (∞). */
export type TimerSeconds = number | null;

export type DifficultySetting = IdentityDifficulty | 'mixed';

export interface Settings {
  rounds: number;
  clueSeconds: TimerSeconds;
  guessSeconds: TimerSeconds;
  handSize: number;
  maxClues: number;
  difficulty: DifficultySetting;
}

// ─────────────────────────────────────────────────────────────
//  Machine à états
// ─────────────────────────────────────────────────────────────

export type Phase =
  | 'LOBBY'
  | 'IDENTITY_REVEAL'
  | 'CLUE_SELECTION'
  | 'GUESSING'
  | 'RESULTS'
  | 'SCOREBOARD'
  | 'FINAL_RESULTS';

export const PHASES: readonly Phase[] = [
  'LOBBY',
  'IDENTITY_REVEAL',
  'CLUE_SELECTION',
  'GUESSING',
  'RESULTS',
  'SCOREBOARD',
  'FINAL_RESULTS',
] as const;

// ─────────────────────────────────────────────────────────────
//  État serveur (autoritaire — jamais sérialisé tel quel)
// ─────────────────────────────────────────────────────────────

export interface Player {
  id: PlayerId;
  /** Secret. Ne quitte jamais le serveur, sauf vers son propriétaire. */
  sessionToken: string;
  socketId: string | null;
  nickname: string;
  score: number;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
}

export interface PlayerRound {
  identityId: IdentityId;
  hand: IconId[];
  selectedIcons: IconId[];
  cluesSubmitted: boolean;
  /** label → identityId */
  guesses: Record<Label, IdentityId>;
  guessesSubmitted: boolean;
  roundScoreGiven: number;
  roundScoreGuessed: number;
}

export interface Round {
  roundNumber: number;
  phase: Phase;
  phaseEndsAt: number | null;
  /** ⚠ SECRET jusqu'à la phase RESULTS. */
  labelMap: Record<Label, PlayerId>;
  assignments: Map<PlayerId, PlayerRound>;
}

export interface Game {
  code: string;
  hostId: PlayerId;
  phase: Phase;
  currentRound: number;
  settings: Settings;
  players: Map<PlayerId, Player>;
  rounds: Round[];
  usedIdentityIds: Set<IdentityId>;
  createdAt: number;
  lastActivityAt: number;
  /**
   * Instant de mise en pause faute de joueurs connectés (§9).
   * `null` quand la partie tourne normalement.
   */
  pausedAt: number | null;
}

// ─────────────────────────────────────────────────────────────
//  Vues joueur (ce qui transite réellement sur le socket)
// ─────────────────────────────────────────────────────────────

export interface PublicPlayer {
  id: PlayerId;
  nickname: string;
  score: number;
  connected: boolean;
  isHost: boolean;
}

/** Progression booléenne affichée pendant CLUE_SELECTION / GUESSING. */
export interface PlayerProgress {
  playerId: PlayerId;
  nickname: string;
  submitted: boolean;
}

/** Une série d'indices anonyme présentée pendant GUESSING. */
export interface AnonymousClueSet {
  label: Label;
  iconIds: IconId[];
}

export interface RoundScoreLine {
  playerId: PlayerId;
  nickname: string;
  /** Points « faire deviner ». */
  given: number;
  /** Points « bonnes réponses ». */
  guessed: number;
  /** given + guessed */
  total: number;
  /** Score cumulé après la manche. */
  cumulative: number;
}

/** Révélation d'une série, disponible seulement en phase RESULTS. */
export interface RevealedClueSet {
  label: Label;
  playerId: PlayerId;
  nickname: string;
  identityId: IdentityId;
  iconIds: IconId[];
  /** Joueurs ayant correctement identifié cette série. */
  guessedByPlayerIds: PlayerId[];
  /** Nombre de devineurs possibles (N − 1). */
  possibleGuessers: number;
}

export interface GameStats {
  bestDetective: { playerId: PlayerId; nickname: string; correctGuesses: number } | null;
  bestCluegiver: { playerId: PlayerId; nickname: string; successRate: number } | null;
  hardestIdentity: { identityId: IdentityId; nickname: string; successRate: number } | null;
}

/**
 * Vue complète envoyée à UN joueur donné.
 * Chaque champ optionnel n'est rempli que dans les phases où il est autorisé
 * (cf. §4.4 du cahier des charges).
 */
export interface PlayerView {
  code: string;
  phase: Phase;
  roundNumber: number;
  totalRounds: number;
  phaseEndsAt: number | null;
  serverTime: number;
  settings: Settings;
  you: PublicPlayer;
  players: PublicPlayer[];

  /** IDENTITY_REVEAL → RESULTS : uniquement SA propre identité. */
  yourIdentityId?: IdentityId;

  /** CLUE_SELECTION : sa main, sa sélection en cours. */
  yourHand?: IconId[];
  yourSelectedIcons?: IconId[];
  yourCluesSubmitted?: boolean;

  /** CLUE_SELECTION / GUESSING : progression booléenne des autres. */
  progress?: PlayerProgress[];

  /** GUESSING : les N−1 séries anonymes + les N−1 identités possibles. */
  clueSets?: AnonymousClueSet[];
  identityChoices?: IdentityId[];
  yourGuesses?: Record<Label, IdentityId>;
  yourGuessesSubmitted?: boolean;

  /** RESULTS : tout est révélé. */
  reveals?: RevealedClueSet[];
  roundScores?: RoundScoreLine[];

  /** SCOREBOARD / FINAL_RESULTS. */
  standings?: RoundScoreLine[];
  stats?: GameStats;

  /** Partie en pause (moins de 3 joueurs connectés, cf. §9). */
  paused?: boolean;
  pauseReason?: string;
}

// ─────────────────────────────────────────────────────────────
//  Erreurs typées
// ─────────────────────────────────────────────────────────────

export type GameErrorCode =
  | 'GAME_NOT_FOUND'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_FULL'
  | 'NICKNAME_TAKEN'
  | 'INVALID_NICKNAME'
  | 'INVALID_CODE'
  | 'NOT_HOST'
  | 'WRONG_PHASE'
  | 'NOT_ENOUGH_PLAYERS'
  | 'INVALID_PAYLOAD'
  | 'ICON_NOT_IN_HAND'
  | 'TOO_MANY_CLUES'
  | 'NOT_ENOUGH_CLUES'
  | 'INVALID_GUESS'
  | 'TOO_LATE'
  | 'SESSION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'GAME_PAUSED'
  | 'INTERNAL_ERROR';

export interface GameError {
  code: GameErrorCode;
  /** Message prêt à afficher, en français. */
  message: string;
  /** Ex. suggestion de pseudo libre lors d'un NICKNAME_TAKEN. */
  suggestion?: string;
}

/** Réponse standard des acquittements Socket.IO. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: GameError };
