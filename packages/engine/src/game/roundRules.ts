import {
  MIN_CLUES,
  pickOne,
  scoreRound,
  type Game,
  type Phase,
  type PlayerId,
  type Rng,
  type Round,
} from '@identite-secrete/shared';

/**
 * Règles de manche — **fonctions pures**.
 *
 * Aucune ne connaît Socket.IO ni le store : elles transforment un `Game` et un
 * `Round` en place, ou répondent à une question par un booléen. Le moteur
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
    return everyActiveParticipant(game, round, (assignment) => assignment.guessesSubmitted);
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
 *  - il avait une sélection non validée → on la valide telle quelle ;
 *  - il n'avait rien, ou il est déconnecté → **une icône de sa main est tirée
 *    au sort**. Elle sera probablement fausse, mais une série vide priverait
 *    les autres d'une réponse à trouver et fausserait leur score maximum.
 *
 * Retourne les joueurs pour qui une icône a dû être tirée.
 */
export function autoSubmitClues(round: Round, rng: Rng): PlayerId[] {
  const forced: PlayerId[] = [];

  for (const [playerId, assignment] of round.assignments) {
    if (assignment.cluesSubmitted) continue;

    if (assignment.selectedIcons.length < MIN_CLUES && assignment.hand.length > 0) {
      assignment.selectedIcons = [pickOne(rng, assignment.hand)];
      forced.push(playerId);
    }

    assignment.cluesSubmitted = true;
  }

  return forced;
}

/**
 * Clôture de la phase de devinette.
 *
 * Contrairement aux indices, **rien n'est rempli au hasard** : une case laissée
 * vide reste vide et compte comme une réponse fausse (§3.1). Remplir à la place
 * du joueur lui donnerait une chance de marquer sans avoir joué.
 */
export function autoSubmitGuesses(round: Round): void {
  for (const assignment of round.assignments.values()) {
    assignment.guessesSubmitted = true;
  }
}

/**
 * Clôture d'une manche : calcul des scores et report sur les totaux.
 *
 * Le calcul lui-même vit dans `packages/shared/scoring.ts` et ne connaît ni
 * Socket.IO ni `Game`. Ici on ne fait que lui donner ses entrées et ranger
 * ses sorties.
 */
export function settleRound(game: Game, round: Round): void {
  const identityByPlayer: Record<string, string> = {};
  const guessesByPlayer: Record<string, Record<string, string>> = {};

  for (const [playerId, assignment] of round.assignments) {
    identityByPlayer[playerId] = assignment.identityId;
    guessesByPlayer[playerId] = assignment.guesses;
  }

  const scores = scoreRound({
    labelMap: round.labelMap,
    identityByPlayer,
    guessesByPlayer,
  });

  for (const [playerId, assignment] of round.assignments) {
    const score = scores[playerId];
    if (!score) continue;

    assignment.roundScoreGiven = score.given;
    assignment.roundScoreGuessed = score.guessed;

    const player = game.players.get(playerId);
    if (player) player.score += score.total;
  }
}
