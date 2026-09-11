import type { DifficultySetting, Settings, TimerSeconds } from './types';

// ─────────────────────────────────────────────────────────────
//  Joueurs
// ─────────────────────────────────────────────────────────────

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export const MIN_NICKNAME_LENGTH = 1;
export const MAX_NICKNAME_LENGTH = 16;

// ─────────────────────────────────────────────────────────────
//  Code de partie
// ─────────────────────────────────────────────────────────────

/** Alphabet sans ambiguïté : ni 0/O, ni 1/I. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

// ─────────────────────────────────────────────────────────────
//  Règles du jeu — fixées par le livret, pas réglables
// ─────────────────────────────────────────────────────────────

/**
 * Nombre de personnages exposés au centre, et donc de numéros possibles.
 *
 * **Toujours 8, quel que soit le nombre de joueurs.** À trois joueurs, cinq
 * numéros ne correspondent à personne : ce sont ces leurres qui empêchent de
 * trouver par élimination.
 */
export const BOARD_SIZE = 8;

/** La partie prend fin après 4 manches. */
export const TOTAL_ROUNDS = 4;

/**
 * Cartes Picto distribuées à chaque joueur **au lancement, une fois pour toute
 * la partie**. Elles ne sont jamais remplacées : 10 cartes pour 4 manches à
 * 1-3 cartes, c'est là qu'est toute la tension du jeu.
 */
export const STARTING_HAND_CARDS = 10;

/** Pictogrammes qu'un joueur pose dans son boîtier, par manche. */
export const MIN_PICTOS = 1;
export const MAX_PICTOS = 3;

// ─────────────────────────────────────────────────────────────
//  Paramètres : options proposées dans le salon
// ─────────────────────────────────────────────────────────────

export const TIMER_OPTIONS: readonly TimerSeconds[] = [30, 45, 60, 90, null] as const;
export const DIFFICULTY_OPTIONS: readonly DifficultySetting[] = [
  'easy',
  'medium',
  'hard',
  'mixed',
] as const;

export const DEFAULT_SETTINGS: Settings = {
  clueSeconds: 60,
  guessSeconds: 60,
  difficulty: 'medium',
};

// ─────────────────────────────────────────────────────────────
//  Quotas de composition d'une main (cf. §8.3)
// ─────────────────────────────────────────────────────────────

/**
 * Minimums par catégorie sur les pictogrammes d'une main.
 *
 * Une main de 10 cartes porte 20 pictogrammes : ces quotas s'appliquent à
 * l'ensemble, pour qu'aucun joueur ne se retrouve avec vingt symboles abstraits
 * et rien de concret.
 */
export const HAND_CATEGORY_QUOTAS = {
  symbole: 2,
  objet: 2,
  animal: 1,
  action: 1,
} as const;

// ─────────────────────────────────────────────────────────────
//  Durées (millisecondes)
// ─────────────────────────────────────────────────────────────

/**
 * Durée fixe de l'écran « Ta carte Mystère ».
 *
 * Plus longue que la simple lecture d'un nom : c'est là qu'on découvre les huit
 * personnages du plateau en même temps que le sien.
 */
export const IDENTITY_REVEAL_MS = 8_000;
/** Intervalle entre deux révélations séquentielles en phase RESULTS. */
export const REVEAL_STEP_MS = 1_500;
/** Marge après la dernière révélation avant de passer au classement. */
export const RESULTS_TAIL_MS = 3_000;
/** Démarrage automatique de la manche suivante depuis le classement. */
export const SCOREBOARD_AUTO_NEXT_MS = 20_000;
/** Période de grâce après une déconnexion avant retrait effectif. */
export const DISCONNECT_GRACE_MS = 60_000;
/** Délai avant transfert automatique du rôle d'hôte. */
export const HOST_TRANSFER_DELAY_MS = 30_000;
/**
 * Durée au bout de laquelle une partie en pause faute de joueurs retourne au
 * salon. Assez long pour couvrir un changement de wagon, assez court pour ne
 * pas laisser trois personnes devant un écran figé.
 */
export const PAUSE_ABANDON_MS = 2 * 60 * 1_000;

/** Purge des parties inactives. */
export const GAME_TTL_MS = 2 * 60 * 60 * 1_000;
/** Fréquence de la boucle de purge. */
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000;
/** Tolérance accordée au client sur l'expiration d'un timer (latence réseau). */
export const TIMER_GRACE_MS = 1_500;

/** Seuil d'affichage « urgence » du décompte, en secondes. */
export const TIMER_URGENT_SECONDS = 10;

// ─────────────────────────────────────────────────────────────
//  Limitation de débit
// ─────────────────────────────────────────────────────────────

/** Fenêtre glissante de comptage des événements entrants, par socket. */
export const RATE_LIMIT_WINDOW_MS = 10_000;
/**
 * Plafond d'événements par fenêtre. Généreux : un joueur qui tapote ses icônes
 * ne doit jamais l'atteindre. Il ne vise que les boucles automatisées.
 */
export const RATE_LIMIT_MAX_EVENTS = 60;

// ─────────────────────────────────────────────────────────────
//  Divers
// ─────────────────────────────────────────────────────────────

export const SESSION_STORAGE_KEY = 'identite-secrete:session';
export const SOUND_STORAGE_KEY = 'identite-secrete:sound';

/** Palette d'avatars, dérivée de l'id du joueur. */
export const AVATAR_COLORS = [
  '#5B3DF5',
  '#FF3D8B',
  '#12B886',
  '#FF8A3D',
  '#2BB3FF',
  '#B14DFF',
  '#E8B400',
  '#FF5A5A',
] as const;
