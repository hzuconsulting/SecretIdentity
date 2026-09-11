import {
  cardIcons,
  pickOne,
  scoreRound,
  type Game,
  type Phase,
  type PlayerId,
  type Rng,
  type Round,
  type Slot,
} from '@identite-secrete/shared';
import { playedCardIds } from './clues';

/**
 * Règles de manche — **fonctions pures**.
 *
 * Aucune ne connaît le transport ni le store : elles transforment un `Game` et
 * un `Round` en place, ou répondent à une question par un booléen. Le moteur
 * (`engine.ts`) décide *quand* les appeler ; ce fichier décide *ce qu'elles
 * font*. La séparation permet de les lire — et de les relire — sans avoir la
 * machine à états en tête.
 */

/** Phases pendant lesquelles une pause a un sens. */
export function isPausablePhase(phase: Phase): boolean {
  return phase !== 'LOBBY' && phase !== 'FINAL_RESULTS';
}

/**
 * La phase peut-elle se terminer avant son échéance ?
 *
 * Un joueur déconnecté ne bloque jamais : il ne peut pas soumettre, donc on ne
 * l'attend pas. C'est le minuteur qui tranchera pour lui.
 */
export function isPhaseComplete(game: Game, round: Round): boolean {
  if (game.phase === 'CLUE_SELECTION') {
    return everyActiveParticipant(game, round, (assignment) => assignment.cluesSubmitted);
  }

  if (game.phase === 'GUESSING') {
    return everyActiveParticipant(game, round, (assignment) => assignment.votesSubmitted);
  }

  return false;
}

function everyActiveParticipant(
  game: Game,
  round: Round,
  predicate: (assignment: NonNullable<ReturnType<Round['assignments']['get']>>) => boolean,
): boolean {
  let considered = 0;

  for (const [playerId, assignment] of round.assignments) {
    const player = game.players.get(playerId);
    if (!player || !player.connected) continue;

    considered += 1;
    if (!predicate(assignment)) return false;
  }

  // Personne de connecté : on laisse le minuteur décider plutôt que d'enchaîner
  // instantanément sur une manche que personne ne voit.
  return considered > 0;
}

/**
 * Validation automatique en fin de minuteur (§7.3).
 *
 * Trois cas au moment où `CLUE_SELECTION` se termine :
 *  - le joueur a validé → on ne touche à rien ;
 *  - il avait posé sans valider → on valide tel quel ;
 *  - il n'avait rien posé, ou il est déconnecté → **une carte de sa main est
 *    tirée au sort**, l'un de ses quatre pictogrammes au hasard, en zone verte.
 *    Elle sera probablement
 *    fausse, mais un boîtier vide priverait les autres d'une réponse à trouver
 *    et fausserait leur score maximum.
 *
 * Une main vide — cas limite d'une fin de partie où tout a été dépensé — laisse
 * simplement le boîtier vide plutôt que de planter.
 *
 * Retourne les joueurs pour qui une carte a dû être tirée.
 */
export function autoSubmitClues(game: Game, round: Round, rng: Rng): PlayerId[] {
  const forced: PlayerId[] = [];

  for (const [playerId, assignment] of round.assignments) {
    if (assignment.cluesSubmitted) continue;

    if (assignment.placed.length === 0) {
      const hand = game.players.get(playerId)?.hand ?? [];
      if (hand.length > 0) {
        const card = pickOne(rng, hand);
        const iconId = pickOne(rng, cardIcons(card));
        assignment.placed = [{ cardId: card.id, iconId, zone: 'green' }];
        forced.push(playerId);
      }
    }

    assignment.cluesSubmitted = true;
  }

  return forced;
}

/**
 * Défausse des cartes jouées.
 *
 * Appelée une seule fois par manche, à la fermeture de `CLUE_SELECTION`. C'est
 * le point où la main rétrécit — définitivement : rien ne la recharge, et ce
 * qu'il en reste départage les ex æquo en fin de partie.
 */
export function discardPlayedCards(game: Game, round: Round): void {
  for (const [playerId, assignment] of round.assignments) {
    const player = game.players.get(playerId);
    if (!player) continue;

    const played = playedCardIds(assignment.placed);
    if (played.size === 0) continue;

    player.hand = player.hand.filter((card) => !played.has(card.id));
  }
}

/**
 * Clôture de la phase de vote.
 *
 * Contrairement aux pictogrammes, **rien n'est rempli au hasard** : une case
 * laissée vide reste vide et compte comme un vote perdu. Voter à la place du
 * joueur lui donnerait une chance de marquer sans avoir joué.
 */
export function autoSubmitVotes(round: Round): void {
  for (const assignment of round.assignments.values()) {
    assignment.votesSubmitted = true;
  }
}

/**
 * Clôture d'une manche : calcul des scores et report sur les totaux.
 *
 * Le calcul lui-même vit dans `packages/shared/scoring.ts` et ne connaît ni le
 * transport ni `Game`. Ici on ne fait que lui donner ses entrées et ranger ses
 * sorties.
 */
export function settleRound(game: Game, round: Round): void {
  const scores = scoreRound(roundScoringInput(round));

  for (const [playerId, assignment] of round.assignments) {
    const score = scores[playerId];
    if (!score) continue;

    assignment.roundScoreGiven = score.given;
    assignment.roundScoreGuessed = score.guessed;

    const player = game.players.get(playerId);
    if (player) player.score += score.total;
  }
}

/** Entrées du calcul de score, extraites d'une manche. */
export function roundScoringInput(round: Round): {
  slotByPlayer: Record<PlayerId, Slot>;
  votesByPlayer: Record<PlayerId, Record<PlayerId, Slot>>;
} {
  const slotByPlayer: Record<PlayerId, Slot> = {};
  const votesByPlayer: Record<PlayerId, Record<PlayerId, Slot>> = {};

  for (const [playerId, assignment] of round.assignments) {
    slotByPlayer[playerId] = assignment.slot;
    votesByPlayer[playerId] = assignment.votes;
  }

  return { slotByPlayer, votesByPlayer };
}
