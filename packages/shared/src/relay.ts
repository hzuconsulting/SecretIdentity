import { z } from 'zod';
import {
  BOARD_SIZE,
  MAX_NICKNAME_LENGTH,
  MAX_PLAYERS,
  STARTING_HAND_CARDS,
  TOTAL_ROUNDS,
} from './constants';
import { gameCodeSchema, nicknameSchema, settingsSchema } from './events';
import type { IdentityId, PlayerId, Settings, Slot } from './types';

/**
 * L'instantané de relais : ce qu'un joueur reçoit pour pouvoir reprendre la
 * partie si l'hôte disparaît.
 *
 * ─── Pourquoi ce n'est pas l'état du jeu ───
 *
 * L'état autoritaire contient les secrets de **tout le monde** : le numéro
 * attribué à chaque joueur, sa main de cartes, son jeton de session. Le
 * diffuser reviendrait à donner les réponses à celui qui le reçoit — dans un
 * jeu qui repose entièrement sur le fait que personne ne les connaisse.
 *
 * L'instantané est donc construit pour ne porter **aucun secret vivant**. C'est
 * ce qui permet de l'envoyer à tous les joueurs plutôt qu'à un successeur
 * désigné, et c'est un gain double : plus de secret à protéger, et plus de
 * point unique de défaillance — n'importe lequel des survivants peut reprendre.
 *
 * ─── Ce que ça coûte ───
 *
 * La manche en cours n'est pas transportée, parce qu'elle *est* le secret. Une
 * reprise atterrit donc sur le classement de la dernière manche réglée, et la
 * manche interrompue est rejouée. Les scores acquis, eux, sont intacts.
 *
 * ─── Les deux champs qui demandent une explication ───
 *
 * `sessionHash` remplace le jeton de session : c'est son empreinte SHA-256. Le
 * joueur prouve son identité en présentant le jeton — qu'il a déjà dans son
 * propre stockage — et le nouvel hôte vérifie l'empreinte. Il peut donc
 * reconnaître tout le monde sans jamais avoir pu usurper personne.
 *
 * `cardsLeft` est le nombre de cartes restantes, pas les cartes elles-mêmes.
 * Il est déjà public (c'est le départage du classement) et il suffit : le
 * nouvel hôte redistribue le même **nombre** de cartes, tirées à neuf.
 */

/**
 * Version du format.
 *
 * Séparée de `PERSISTENCE_VERSION` : la sauvegarde locale et l'instantané
 * réseau n'évoluent pas au même rythme, et les confondre obligerait à casser
 * l'un pour faire évoluer l'autre.
 */
export const RELAY_SNAPSHOT_VERSION = 1;

/**
 * Plafond de taille d'un instantané encodé.
 *
 * Très en dessous du plafond du canal (60 000) : un instantané réaliste à huit
 * joueurs pèse une vingtaine de kilo-octets. La marge est là pour qu'un
 * dépassement soit un signal, pas une déconnexion — le canal se fermerait sur
 * un envoi trop gros, et la migration cesserait de fonctionner en silence.
 */
export const MAX_RELAY_JSON_CHARS = 32_000;

/**
 * Les seules phases sur lesquelles une reprise peut atterrir.
 *
 * Aucune ne comporte de matériel secret en cours : le salon n'a rien distribué,
 * le classement et la fin de partie ont tout révélé. C'est cette contrainte —
 * exprimée dans le type, pas seulement dans un commentaire — qui garantit
 * qu'aucun instantané ne peut décrire une manche en cours.
 */
export type RelayPhase = 'LOBBY' | 'SCOREBOARD' | 'FINAL_RESULTS';

export interface RelayPlayer {
  id: PlayerId;
  nickname: string;
  score: number;
  /** Ordre d'arrivée. Seul son **ordre** est lu, jamais sa valeur absolue. */
  joinedAt: number;
  /** Empreinte SHA-256 du jeton de session, en hexadécimal. Jamais le jeton. */
  sessionHash: string;
  /** Nombre de cartes restantes — déjà public, et départage du classement. */
  cardsLeft: number;
}

export interface RelayAssignment {
  slot: Slot;
  votes: Record<PlayerId, Slot>;
  roundScoreGiven: number;
  roundScoreGuessed: number;
}

/** Une manche **réglée**. Une manche en cours n'apparaît jamais ici. */
export interface RelayRound {
  roundNumber: number;
  /** Les huit personnages étaient face visible au centre de la table. */
  board: IdentityId[];
  assignments: Array<[PlayerId, RelayAssignment]>;
}

export interface RelaySnapshot {
  v: number;
  code: string;
  /** L'hôte du **salon** — celui qui a les boutons, pas celui qui héberge. */
  hostId: PlayerId;
  phase: RelayPhase;
  /** Invariant : toujours égal à `rounds.length`. */
  currentRound: number;
  settings: Settings;
  players: RelayPlayer[];
  rounds: RelayRound[];
  usedIdentityIds: IdentityId[];
  bannedNicknames: string[];
  /**
   * Génération de l'hébergement.
   *
   * Incrémentée à chaque reprise. C'est la seule protection contre un ancien
   * hôte qui reviendrait servir un état périmé : une vue d'une génération
   * inférieure est ignorée.
   */
  epoch: number;
  /** Compteur monotone : départage deux instantanés sans dépendre des horloges. */
  seq: number;
  /** Horloge de l'émetteur. Journal uniquement — jamais utilisée pour décider. */
  issuedAt: number;
}

/** Ce qu'un invité reçoit : l'instantané, et sa place dans la file de succession. */
export interface RelayHandoffPayload {
  snapshot: RelaySnapshot;
  /** Rang dans la file. 0 tente la reprise en premier. */
  rank: number;
  /** Taille de la file : savoir si on est seul change ce qu'on affiche. */
  successors: number;
}

// ─────────────────────────────────────────────────────────────
//  Validation
// ─────────────────────────────────────────────────────────────

/**
 * L'instantané vient d'un pair qu'on ne contrôle pas, et celui qui l'adopte
 * devient autoritaire pour tous les autres. C'est donc la surface la plus
 * sensible du projet après les payloads d'action — et elle est validée avec la
 * même rigueur : structure, bornes, puis invariants croisés.
 *
 * Règle de conduite, reprise de `deserializeGame` : au moindre défaut on
 * **rejette en bloc**. Jamais de réparation partielle. Repartir du salon est
 * toujours préférable à une partie à moitié convertie.
 */

const idSchema = z.string().min(1).max(64);
const slotSchema = z.number().int().min(1).max(BOARD_SIZE);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Empreinte invalide.');
const timestampSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Plafond théorique : 4 manches × 2 façons de marquer × (8 − 1) adversaires. */
const MAX_SCORE = TOTAL_ROUNDS * 2 * (MAX_PLAYERS - 1);

const relayPlayerSchema = z.object({
  id: idSchema,
  nickname: nicknameSchema,
  score: z.number().int().min(0).max(MAX_SCORE),
  joinedAt: timestampSchema,
  sessionHash: hashSchema,
  cardsLeft: z.number().int().min(0).max(STARTING_HAND_CARDS),
});

const relayAssignmentSchema = z.object({
  slot: slotSchema,
  votes: z.record(idSchema, slotSchema),
  roundScoreGiven: z.number().int().min(0).max(MAX_PLAYERS - 1),
  roundScoreGuessed: z.number().int().min(0).max(MAX_PLAYERS - 1),
});

const relayRoundSchema = z.object({
  roundNumber: z.number().int().min(1).max(TOTAL_ROUNDS),
  board: z.array(idSchema).length(BOARD_SIZE),
  assignments: z.array(z.tuple([idSchema, relayAssignmentSchema])).max(MAX_PLAYERS),
});

const relaySnapshotShape = z.object({
  v: z.literal(RELAY_SNAPSHOT_VERSION),
  code: gameCodeSchema,
  hostId: idSchema,
  phase: z.enum(['LOBBY', 'SCOREBOARD', 'FINAL_RESULTS']),
  currentRound: z.number().int().min(0).max(TOTAL_ROUNDS),
  settings: settingsSchema,
  players: z.array(relayPlayerSchema).min(1).max(MAX_PLAYERS),
  rounds: z.array(relayRoundSchema).max(TOTAL_ROUNDS),
  usedIdentityIds: z.array(idSchema).max(TOTAL_ROUNDS * BOARD_SIZE * 2),
  bannedNicknames: z.array(z.string().min(1).max(MAX_NICKNAME_LENGTH)).max(4 * MAX_PLAYERS),
  epoch: z.number().int().min(0).max(1_000),
  seq: z.number().int().min(0),
  issuedAt: timestampSchema,
});

type RawSnapshot = z.infer<typeof relaySnapshotShape>;

/**
 * Les contrôles que la forme seule ne peut pas exprimer.
 *
 * Le plus important est le nombre de joueurs : `dealSlots` lève une exception
 * au-delà de huit, donc un instantané à neuf joueurs ferait planter la première
 * manche ouverte après la reprise — bien après qu'on ait pu comprendre pourquoi.
 */
function checkInvariants(snapshot: RawSnapshot, ctx: z.RefinementCtx): void {
  const reject = (message: string, path?: (string | number)[]): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, ...(path ? { path } : {}) });
  };

  const ids = new Set<PlayerId>();
  const hashes = new Set<string>();
  const nicknames = new Set<string>();

  for (const player of snapshot.players) {
    if (ids.has(player.id)) reject('Deux joueurs partagent le même identifiant.', ['players']);
    if (hashes.has(player.sessionHash)) {
      reject('Deux joueurs partagent la même empreinte de session.', ['players']);
    }
    // `nicknameSchema` applique un `.trim()` transformant : l'unicité se
    // vérifie donc **après** transformation, sinon deux pseudos distincts avant
    // nettoyage entreraient en collision après, et casseraient `takenNicknames`.
    const nickname = player.nickname.toLowerCase();
    if (nicknames.has(nickname)) reject('Deux joueurs portent le même pseudo.', ['players']);

    ids.add(player.id);
    hashes.add(player.sessionHash);
    nicknames.add(nickname);
  }

  if (!ids.has(snapshot.hostId)) {
    reject('L’hôte du salon ne fait pas partie des joueurs.', ['hostId']);
  }

  if (snapshot.currentRound !== snapshot.rounds.length) {
    reject('Le numéro de manche ne correspond pas aux manches transmises.', ['currentRound']);
  }

  snapshot.rounds.forEach((round, index) => {
    if (round.roundNumber !== index + 1) {
      reject('Les manches ne sont pas dans l’ordre.', ['rounds', index]);
    }

    for (const [playerId, assignment] of round.assignments) {
      if (!ids.has(playerId)) {
        reject('Une attribution vise un joueur inconnu.', ['rounds', index]);
      }
      for (const voterId of Object.keys(assignment.votes)) {
        if (!ids.has(voterId)) {
          reject('Un vote vient d’un joueur inconnu.', ['rounds', index]);
        }
        if (voterId === playerId) {
          reject('Un joueur ne peut pas voter pour lui-même.', ['rounds', index]);
        }
      }
    }
  });

  // Cohérence de la phase avec ce qui l'accompagne. Un salon qui arriverait
  // avec des scores décrirait une partie commencée, donc un instantané forgé.
  if (snapshot.phase === 'LOBBY') {
    if (snapshot.rounds.length > 0) reject('Un salon n’a pas de manche jouée.', ['phase']);
    if (snapshot.players.some((player) => player.score !== 0 || player.cardsLeft !== 0)) {
      reject('Un salon n’a ni score ni carte distribuée.', ['phase']);
    }
  }

  if (snapshot.phase === 'SCOREBOARD' && snapshot.rounds.length === 0) {
    reject('Un classement suppose au moins une manche réglée.', ['phase']);
  }

  if (snapshot.phase === 'FINAL_RESULTS' && snapshot.rounds.length !== TOTAL_ROUNDS) {
    reject('Une fin de partie suppose toutes les manches jouées.', ['phase']);
  }
}

export const relaySnapshotSchema = relaySnapshotShape.superRefine(checkInvariants);

export const relayHandoffSchema = z.object({
  snapshot: relaySnapshotSchema,
  rank: z.number().int().min(0).max(MAX_PLAYERS),
  successors: z.number().int().min(0).max(MAX_PLAYERS),
});

/** Valide un instantané reçu. `null` si quoi que ce soit cloche. */
export function parseRelaySnapshot(value: unknown): RelaySnapshot | null {
  const parsed = relaySnapshotSchema.safeParse(value);
  return parsed.success ? (parsed.data as RelaySnapshot) : null;
}

/** Valide une passation reçue. `null` si quoi que ce soit cloche. */
export function parseRelayHandoff(value: unknown): RelayHandoffPayload | null {
  const parsed = relayHandoffSchema.safeParse(value);
  return parsed.success ? (parsed.data as RelayHandoffPayload) : null;
}
