import {
  BOARD_SIZE,
  drawIdentities,
  shuffle,
  type Game,
  type IdentityId,
  type PlayerId,
  type PlayerRound,
  type Rng,
  type Round,
  type Slot,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from './factory';

/**
 * Construction d'une manche.
 *
 * Deux tirages ont lieu ici, et **uniquement** ici :
 *  - les `BOARD_SIZE` personnages du plateau — **publics**, comme les cartes
 *    posées face visible au centre de la table ;
 *  - le numéro secret de chaque joueur, c'est-à-dire sa carte Mystère.
 *
 * La main de cartes Picto, elle, n'est **pas** tirée ici : elle est distribuée
 * une seule fois au lancement de la partie et ne se recharge jamais.
 *
 * Rien du secret ne quitte l'hôte avant la phase autorisée : c'est
 * `serialization/playerView.ts` qui décide, phase par phase, de ce qui sort.
 */

/**
 * Joueurs pris en compte pour la manche : ceux présents au moment du tirage,
 * connectés ou **momentanément** déconnectés — une coupure de réseau ne doit
 * pas coûter une manche.
 *
 * Ne sont pas servis : un joueur exclu (retiré de `game.players`), et un joueur
 * **absent** — parti en cours de partie, ou pas revenu à temps. Il garde sa
 * place et reprendra à la manche suivante dès qu'il reviendra.
 */
export function roundParticipants(game: Game): PlayerId[] {
  return playersInJoinOrder(game)
    .filter((player) => !player.away)
    .map((player) => player.id);
}

export function createRound(game: Game, roundNumber: number, rng: Rng): Round {
  const participants = roundParticipants(game);

  // Toujours BOARD_SIZE personnages, indépendamment du nombre de joueurs : à
  // trois, cinq numéros ne désignent personne. Sans ces leurres, il suffirait
  // d'éliminer pour gagner.
  const { identities, poolReset } = drawIdentities(
    {
      count: BOARD_SIZE,
      difficulty: game.settings.difficulty,
      usedIdentityIds: game.usedIdentityIds,
    },
    rng,
  );

  // Le pool a dû être réinitialisé : on repart d'un ensemble vide plutôt que
  // de laisser grossir un `Set` qui ne filtre plus rien (§9).
  if (poolReset) game.usedIdentityIds.clear();

  const board: IdentityId[] = identities.map((identity) => identity.id);
  for (const identityId of board) game.usedIdentityIds.add(identityId);

  const slots = dealSlots(participants.length, rng);
  const assignments = new Map<PlayerId, PlayerRound>();

  participants.forEach((playerId, index) => {
    const slot = slots[index];
    if (slot === undefined) throw new Error('createRound: plus de cartes Mystère disponibles');

    assignments.set(playerId, {
      slot,
      placed: [],
      cluesSubmitted: false,
      votes: {},
      votesSubmitted: false,
      roundScoreGiven: 0,
      roundScoreGuessed: 0,
    });
  });

  return {
    roundNumber,
    phase: 'IDENTITY_REVEAL',
    phaseEndsAt: null,
    board,
    assignments,
  };
}

/**
 * Distribution des cartes Mystère.
 *
 * On mélange les huit numéros et on en donne un à chaque joueur : les numéros
 * attribués sont donc **distincts**, et ceux qui restent sont les leurres. On
 * mélange les numéros, pas les joueurs — sans quoi l'ordre d'arrivée dans le
 * salon transparaîtrait dans les numéros.
 */
export function dealSlots(playerCount: number, rng: Rng): Slot[] {
  if (playerCount > BOARD_SIZE) {
    throw new Error(`dealSlots: ${playerCount} joueurs pour ${BOARD_SIZE} cartes Mystère`);
  }

  const all: Slot[] = Array.from({ length: BOARD_SIZE }, (_, index) => index + 1);
  return shuffle(rng, all).slice(0, playerCount);
}

/** Le personnage qu'un joueur doit faire deviner. `null` s'il ne joue pas la manche. */
export function identityOf(round: Round, playerId: PlayerId): IdentityId | null {
  const assignment = round.assignments.get(playerId);
  if (!assignment) return null;
  return round.board[assignment.slot - 1] ?? null;
}

/** Le personnage désigné par un numéro. `null` si le numéro sort du plateau. */
export function identityAtSlot(round: Round, slot: Slot): IdentityId | null {
  return round.board[slot - 1] ?? null;
}

/**
 * Les adversaires pour qui un joueur doit voter.
 *
 * Participants de la manche encore présents dans la partie, soi-même exclu. Un
 * joueur parti ou exclu en cours de manche disparaît donc des bulletins : on ne
 * demande pas de voter pour quelqu'un qui n'est plus là. Une seule définition,
 * partagée par la vue et par la validation — sinon l'interface proposerait des
 * votes que le moteur refuserait.
 */
export function opponentIdsFor(game: Game, round: Round, playerId: PlayerId): PlayerId[] {
  return playersInJoinOrder(game)
    .filter((player) => player.id !== playerId && round.assignments.has(player.id))
    .map((player) => player.id);
}

/** Numéros qui ne sont attribués à personne — les leurres de la manche. */
export function decoySlots(round: Round): Slot[] {
  const taken = new Set<Slot>();
  for (const assignment of round.assignments.values()) taken.add(assignment.slot);

  const decoys: Slot[] = [];
  for (let slot = 1; slot <= round.board.length; slot++) {
    if (!taken.has(slot)) decoys.push(slot);
  }
  return decoys;
}

export function currentRound(game: Game): Round | null {
  return game.rounds[game.currentRound - 1] ?? null;
}
