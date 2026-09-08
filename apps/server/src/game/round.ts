import {
  LABELS,
  dealHand,
  drawIdentities,
  shuffle,
  type Game,
  type Label,
  type PlayerId,
  type PlayerRound,
  type Rng,
  type Round,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from './factory';

/**
 * Construction d'une manche.
 *
 * Trois tirages secrets ont lieu ici, et **uniquement** ici :
 *  - l'identité de chaque joueur (distincte dans la manche, non réutilisée
 *    dans la partie) ;
 *  - sa main d'icônes ;
 *  - la permutation `label → playerId`, qui rend les séries anonymes.
 *
 * Rien de tout cela ne quitte le serveur avant la phase autorisée : c'est
 * `serialization/playerView.ts` qui décide, phase par phase, de ce qui sort.
 */

/**
 * Joueurs pris en compte pour la manche : tous ceux présents dans le salon au
 * moment du tirage, connectés ou non. Un joueur momentanément déconnecté garde
 * sa place et peut revenir en cours de manche ; un joueur qui a **quitté** a
 * déjà été retiré de `game.players` et n'est donc pas servi (§9).
 */
export function roundParticipants(game: Game): PlayerId[] {
  return playersInJoinOrder(game).map((player) => player.id);
}

export function createRound(game: Game, roundNumber: number, rng: Rng): Round {
  const participants = roundParticipants(game);

  const { identities, poolReset } = drawIdentities(
    {
      count: participants.length,
      difficulty: game.settings.difficulty,
      usedIdentityIds: game.usedIdentityIds,
    },
    rng,
  );

  // Le pool a dû être réinitialisé : on repart d'un ensemble vide plutôt que
  // de laisser grossir un `Set` qui ne filtre plus rien (§9).
  if (poolReset) game.usedIdentityIds.clear();

  const assignments = new Map<PlayerId, PlayerRound>();

  participants.forEach((playerId, index) => {
    const identity = identities[index];
    if (!identity) throw new Error('createRound: identités insuffisantes');

    game.usedIdentityIds.add(identity.id);

    assignments.set(playerId, {
      identityId: identity.id,
      hand: dealHand({ handSize: game.settings.handSize }, rng),
      selectedIcons: [],
      cluesSubmitted: false,
      guesses: {},
      guessesSubmitted: false,
      roundScoreGiven: 0,
      roundScoreGuessed: 0,
    });
  });

  return {
    roundNumber,
    phase: 'IDENTITY_REVEAL',
    phaseEndsAt: null,
    labelMap: buildLabelMap(participants, rng),
    assignments,
  };
}

/**
 * Permutation aléatoire des étiquettes.
 *
 * On mélange les joueurs, **pas** les étiquettes : `A` est toujours affichée en
 * premier, et c'est le joueur derrière qui change. Mélanger les étiquettes
 * laisserait l'ordre d'affichage corrélé à l'ordre d'arrivée dans le salon.
 */
export function buildLabelMap(participants: PlayerId[], rng: Rng): Record<Label, PlayerId> {
  const shuffled = shuffle(rng, participants);
  const labelMap: Record<Label, PlayerId> = {};

  shuffled.forEach((playerId, index) => {
    const label = LABELS[index];
    if (!label) throw new Error('buildLabelMap: plus d’étiquettes disponibles');
    labelMap[label] = playerId;
  });

  return labelMap;
}

/** Étiquette d'un joueur dans la manche. `null` s'il n'y participe pas. */
export function labelOf(round: Round, playerId: PlayerId): Label | null {
  for (const [label, id] of Object.entries(round.labelMap)) {
    if (id === playerId) return label;
  }
  return null;
}

export function currentRound(game: Game): Round | null {
  return game.rounds[game.currentRound - 1] ?? null;
}
