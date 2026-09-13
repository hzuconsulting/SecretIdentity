/**
 * Types partagés client / serveur.
 * Aucune dépendance à Socket.IO ni à React ici : ce fichier doit rester
 * importable depuis n'importe quel environnement.
 */

// ─────────────────────────────────────────────────────────────
//  Identifiants
// ─────────────────────────────────────────────────────────────

export type PlayerId = string;

/** Identifiant d'une identité ("harry-potter"). */
export type IdentityId = string;

/** Identifiant d'un pictogramme ("lightning"). */
export type IconId = string;

/**
 * Numéro d'un emplacement du plateau, de 1 à `BOARD_SIZE`.
 *
 * C'est le chiffre porté par une carte Mystère, et celui que désigne une carte
 * Vote. `slot` et `board[slot - 1]` sont les deux faces d'une même chose : le
 * numéro circule, l'identité reste secrète tant que la phase ne l'autorise pas.
 */
export type Slot = number;

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
//  Cartes Picto
// ─────────────────────────────────────────────────────────────

/** Une face de carte Picto : deux pictogrammes. */
export type PictoFace = [IconId, IconId];

/**
 * Une carte Picto : **deux faces de deux pictogrammes**, soit quatre par carte.
 *
 * Comme dans la boîte : on glisse la carte dans un emplacement du boîtier, côté
 * recto ou verso, de sorte qu'**un seul** des quatre pictogrammes reste visible.
 * La carte entière part ensuite à la défausse — les trois autres avec elle.
 * C'est ce qui rend chaque carte précieuse : quatre idées, une seule jouée.
 */
export interface PictoCard {
  /** Unique dans la main d'un joueur, pour toute la partie. */
  id: string;
  front: PictoFace;
  back: PictoFace;
}

/**
 * Les deux emplacements du boîtier.
 *
 * `green` — « ce pictogramme est représentatif de mon personnage ».
 * `red`   — « ce pictogramme n'est **pas** représentatif de mon personnage ».
 */
export type PictoZone = 'green' | 'red';

/**
 * Un pictogramme **tel que les autres le voient** : l'image et la zone.
 * (Les trois autres pictogrammes de la carte ne sortent jamais.)
 *
 * C'est tout ce dont un adversaire a besoin pour voter, et donc tout ce qui
 * sort. La carte d'où vient l'image ne le regarde pas.
 */
export interface ShownPicto {
  /** Le pictogramme montré — l'un des quatre de la carte. */
  iconId: IconId;
  zone: PictoZone;
}

/** Un pictogramme posé dans son propre boîtier : en plus, la carte d'origine. */
export interface PlacedPicto extends ShownPicto {
  /** La carte jouée — elle part à la défausse, avec ses trois autres pictogrammes. */
  cardId: string;
}

// ─────────────────────────────────────────────────────────────
//  Paramètres de partie
// ─────────────────────────────────────────────────────────────

/** Durée effective, en secondes. `null` signifie « pas de limite de temps » (∞). */
export type TimerSeconds = number | null;

/**
 * Réglage d'une durée de phase : une valeur fixe, sans limite (`null`), ou
 * `'auto'` — calculée à l'entrée de la phase selon le nombre de joueurs de la
 * manche (voir `phaseTiming.ts`).
 */
export type TimerSetting = TimerSeconds | 'auto';

export type DifficultySetting = IdentityDifficulty | 'mixed';

/**
 * Visibilité d'une partie.
 *
 * `public` — annoncée sur l'accueil, on peut la rejoindre d'un toucher.
 * `private` — jamais annoncée : seul le code permet d'entrer.
 */
export type GameVisibility = 'public' | 'private';

/**
 * Ce qui reste réglable.
 *
 * Le reste est fixé par les règles : 4 manches, 8 personnages sur le plateau,
 * 10 cartes Picto par joueur, 1 à 3 pictogrammes par manche. Les minuteurs, eux,
 * sont propres à l'adaptation en ligne — le jeu de plateau n'en a pas.
 */
export interface Settings {
  clueSeconds: TimerSetting;
  guessSeconds: TimerSetting;
  difficulty: DifficultySetting;
  visibility: GameVisibility;
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
//  État autoritaire (détenu par l'hôte — jamais sérialisé tel quel)
// ─────────────────────────────────────────────────────────────

export interface Player {
  id: PlayerId;
  /** Secret. Ne quitte jamais l'hôte, sauf vers son propriétaire. */
  sessionToken: string;
  /**
   * Empreinte du jeton d'avant une reprise d'hébergement.
   *
   * Présente uniquement sur une partie adoptée depuis un instantané de relais :
   * le nouvel hôte n'a jamais reçu les jetons, seulement leurs empreintes. Le
   * joueur présente le sien, l'empreinte est vérifiée, et ce champ disparaît au
   * profit du jeton réel. Absent le reste du temps.
   */
  sessionTokenHash?: string;
  /** Lien de transport en cours. `null` quand le joueur est déconnecté. */
  connectionId: string | null;
  nickname: string;
  score: number;
  /**
   * Main de cartes Picto — distribuée **une seule fois au lancement**, jamais
   * rechargée. Elle rétrécit à chaque manche, et ce qu'il en reste départage les
   * ex æquo en fin de partie. ⚠ Secret : ne sort que vers son propriétaire.
   */
  hand: PictoCard[];
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
  /**
   * A quitté une partie **en cours**, ou n'est pas revenu à temps.
   *
   * Il garde sa place, ses points et sa main, et peut revenir à tout moment —
   * par sa session, ou en retapant le même pseudo. En attendant, il n'est plus
   * servi dans les manches suivantes : lui attribuer un numéro imposerait aux
   * autres un boîtier fantôme à deviner. Absent (ou `false`) le reste du temps.
   */
  away?: boolean;
}

export interface PlayerRound {
  /** Le chiffre de sa carte Mystère. ⚠ SECRET jusqu'à la phase RESULTS. */
  slot: Slot;
  /** Ce qu'il a posé dans son boîtier. Public dès la phase GUESSING. */
  placed: PlacedPicto[];
  cluesSubmitted: boolean;
  /** adversaire → numéro voté. Une case absente compte comme une erreur. */
  votes: Record<PlayerId, Slot>;
  votesSubmitted: boolean;
  roundScoreGiven: number;
  roundScoreGuessed: number;
}

export interface Round {
  roundNumber: number;
  phase: Phase;
  phaseEndsAt: number | null;
  /**
   * Les personnages du plateau, `board[0]` étant le numéro 1.
   *
   * **Public dès l'ouverture de la manche** : dans le jeu de plateau, les huit
   * cartes sont face visible au centre de la table. Il y en a toujours
   * `BOARD_SIZE`, même à trois joueurs — les numéros non attribués sont des
   * leurres, et c'est précisément ce qui rend la déduction intéressante.
   */
  board: IdentityId[];
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
  /**
   * Pseudos exclus par l'hôte, en minuscules.
   *
   * Un joueur exclu est retiré de `players` : son jeton de session ne
   * correspond donc plus à rien et sa reconnexion échoue d'elle-même. Ce qu'il
   * faut bloquer en plus, c'est le retour par le formulaire de pseudo.
   */
  bannedNicknames: Set<string>;
  createdAt: number;
  lastActivityAt: number;
  /**
   * Génération d'hébergement.
   *
   * 0 à la création, incrémentée à chaque reprise par un autre joueur. Elle ne
   * change rien aux règles : elle sert à trancher entre deux nœuds qui
   * croiraient tous deux héberger la partie — l'ancien hôte revenu après une
   * migration, typiquement. Un client qui reçoit une vue d'une génération
   * inférieure à celle qu'il connaît l'ignore.
   */
  epoch: number;
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
  /**
   * Nombre de cartes Picto encore en main. Publiquement connu — autour d'une
   * table, tout le monde voit la main fondre — et c'est le départage final.
   * Leur **contenu**, lui, reste secret.
   */
  cardsLeft: number;
  connected: boolean;
  /** A quitté la partie en cours ; sa place l'attend. Voir `Player.away`. */
  away: boolean;
  isHost: boolean;
}

/** Progression booléenne affichée pendant CLUE_SELECTION / GUESSING. */
export interface PlayerProgress {
  playerId: PlayerId;
  nickname: string;
  submitted: boolean;
}

/**
 * Le boîtier d'un adversaire pendant la phase de vote.
 *
 * Nominatif : dans les règles, chaque boîtier est posé devant son propriétaire
 * et on vote en le regardant. Ce qui reste secret, c'est son numéro.
 */
export interface OpponentCase {
  playerId: PlayerId;
  nickname: string;
  placed: ShownPicto[];
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
  /** Cartes Picto restantes — départage en cas d'égalité. */
  cardsLeft: number;
}

/** Révélation d'un boîtier, disponible seulement à partir de RESULTS. */
/** Un vote reçu par un joueur, tel qu'on le dépouille en fin de manche. */
export interface RevealedVote {
  /** Le votant. */
  playerId: PlayerId;
  nickname: string;
  /** Le numéro qu'il a proposé. `null` s'il a laissé la case vide. */
  slot: Slot | null;
  correct: boolean;
}

export interface RoundReveal {
  playerId: PlayerId;
  nickname: string;
  /** Le numéro qu'il fallait trouver. */
  slot: Slot;
  identityId: IdentityId;
  placed: ShownPicto[];
  /** Joueurs ayant voté juste pour lui. */
  guessedByPlayerIds: PlayerId[];
  /**
   * Ce que chacun a voté pour lui, juste ou faux, cases vides comprises.
   *
   * C'est ce qu'on veut lire autour de la table une fois la manche finie —
   * « tu m'as pris pour Hercule ? » — et c'est public à ce stade : tout est
   * révélé en phase RESULTS.
   */
  votes: RevealedVote[];
  /** Nombre de votants possibles (N − 1). */
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
  /**
   * Génération d'hébergement de la partie qui émet cette vue.
   *
   * Le seul moyen pour un client de s'apercevoir qu'il reçoit des vues de deux
   * hôtes concurrents — ce qui peut arriver si le courtier est partitionné et
   * laisse deux nœuds réserver le même identifiant. Sans elle, la partie se
   * scinderait en deux sans le moindre symptôme.
   */
  epoch: number;
  phase: Phase;
  roundNumber: number;
  totalRounds: number;
  phaseEndsAt: number | null;
  serverTime: number;
  settings: Settings;
  you: PublicPlayer;
  players: PublicPlayer[];

  /** IDENTITY_REVEAL → RESULTS : les personnages du plateau, numérotés. */
  board?: IdentityId[];

  /** IDENTITY_REVEAL → RESULTS : uniquement SON numéro, et donc SON personnage. */
  yourSlot?: Slot;
  yourIdentityId?: IdentityId;

  /** IDENTITY_REVEAL / CLUE_SELECTION : sa main, son boîtier en cours. */
  yourHand?: PictoCard[];
  yourPlaced?: PlacedPicto[];
  yourCluesSubmitted?: boolean;

  /** CLUE_SELECTION / GUESSING : progression booléenne des autres. */
  progress?: PlayerProgress[];

  /** GUESSING : les boîtiers des adversaires, nommés. */
  opponents?: OpponentCase[];
  yourVotes?: Record<PlayerId, Slot>;
  yourVotesSubmitted?: boolean;

  /** RESULTS : tout est révélé. */
  reveals?: RoundReveal[];
  roundScores?: RoundScoreLine[];

  /** SCOREBOARD / FINAL_RESULTS. */
  standings?: RoundScoreLine[];
  stats?: GameStats;

  /** Partie en pause (moins de `MIN_PLAYERS` joueurs connectés, cf. §9). */
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
  | 'CARD_NOT_IN_HAND'
  | 'TOO_MANY_CLUES'
  | 'NOT_ENOUGH_CLUES'
  | 'INVALID_GUESS'
  | 'TOO_LATE'
  | 'SESSION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'GAME_PAUSED'
  | 'KICKED'
  | 'INTERNAL_ERROR';

export interface GameError {
  code: GameErrorCode;
  /** Message prêt à afficher, en français. */
  message: string;
  /** Ex. suggestion de pseudo libre lors d'un NICKNAME_TAKEN. */
  suggestion?: string;
}

/** Réponse standard des acquittements. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: GameError };
