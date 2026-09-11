import type { IdentityId, PlayerId, RoundScoreLine, Slot } from './types';

/**
 * Calcul de score — **fonction pure**.
 *
 * Aucune dépendance au transport ni à l'état serveur : on entre des données
 * brutes, on sort des points. C'est ce qui rend la règle testable et
 * réutilisable côté client pour l'affichage.
 *
 * Règle du livret :
 *  - « Faire deviner » : +1 par adversaire ayant correctement identifié notre
 *    personnage. Maximum N−1.
 *  - « Deviner »       : +1 par personnage adverse correctement identifié.
 *    Maximum N−1.
 *
 * Un joueur ne vote jamais pour lui-même : un vote portant sur son propre
 * identifiant est ignoré, il ne peut pas rapporter de points.
 */

export interface RoundScoringInput {
  /** Joueur → le numéro de sa carte Mystère pour la manche. */
  slotByPlayer: Record<PlayerId, Slot>;
  /**
   * Votant → ses votes (adversaire → numéro proposé).
   * Une case non remplie est simplement absente : elle compte comme fausse.
   */
  votesByPlayer: Record<PlayerId, Record<PlayerId, Slot>>;
}

export interface PlayerRoundScore {
  playerId: PlayerId;
  /** Points « faire deviner ». */
  given: number;
  /** Points « bonnes réponses ». */
  guessed: number;
  /** given + guessed */
  total: number;
  /** Adversaires que ce joueur a correctement identifiés. */
  correctPlayerIds: PlayerId[];
  /** Joueurs ayant correctement identifié ce joueur. */
  guessedByPlayerIds: PlayerId[];
}

export type RoundScores = Record<PlayerId, PlayerRoundScore>;

export function scoreRound(input: RoundScoringInput): RoundScores {
  const { slotByPlayer, votesByPlayer } = input;

  const scores: RoundScores = {};

  for (const playerId of Object.keys(slotByPlayer)) {
    scores[playerId] = {
      playerId,
      given: 0,
      guessed: 0,
      total: 0,
      correctPlayerIds: [],
      guessedByPlayerIds: [],
    };
  }

  for (const [voterId, votes] of Object.entries(votesByPlayer)) {
    const voterScore = scores[voterId];
    if (!voterScore) continue; // joueur parti en cours de manche

    for (const [targetId, votedSlot] of Object.entries(votes)) {
      if (targetId === voterId) continue; // on ne vote jamais pour soi

      const trueSlot = slotByPlayer[targetId];
      if (trueSlot === undefined || trueSlot !== votedSlot) continue;

      voterScore.guessed += 1;
      voterScore.correctPlayerIds.push(targetId);

      const targetScore = scores[targetId];
      if (targetScore) {
        targetScore.given += 1;
        targetScore.guessedByPlayerIds.push(voterId);
      }
    }
  }

  for (const score of Object.values(scores)) {
    score.total = score.given + score.guessed;
  }

  return scores;
}

/** Maximum atteignable par un joueur sur une manche à N joueurs. */
export function maxRoundScore(playerCount: number): number {
  return Math.max(0, (playerCount - 1) * 2);
}

/**
 * Les joueurs en tête d'un classement déjà trié, départage compris.
 *
 * Le livret départage à égalité de points par le **nombre de cartes Picto
 * gardées**, et s'arrête là : deux joueurs à égalité sur les deux critères
 * partagent la victoire. Plusieurs identifiants ici signifient donc exactement
 * ça, et il faut l'afficher comme tel.
 */
export function leadersOf(standings: readonly RoundScoreLine[]): PlayerId[] {
  const best = standings[0];
  if (!best) return [];

  return standings
    .filter((line) => line.cumulative === best.cumulative && line.cardsLeft === best.cardsLeft)
    .map((line) => line.playerId);
}

// ─────────────────────────────────────────────────────────────
//  Statistiques de fin de partie (§7.1, écran 10)
// ─────────────────────────────────────────────────────────────

export interface CumulativeRoundInput extends RoundScoringInput {
  /** Joueur → le personnage qu'il devait faire deviner dans cette manche. */
  identityByPlayer: Record<PlayerId, IdentityId>;
}

export interface CumulativeStatsInput {
  /** Une entrée par manche jouée. */
  rounds: CumulativeRoundInput[];
}

export interface CumulativeStats {
  /** Joueur → nombre total de personnages correctement devinés. */
  correctGuessesByPlayer: Record<PlayerId, number>;
  /** Joueur → taux de réussite de SES propres pictogrammes, entre 0 et 1. */
  successRateByPlayer: Record<PlayerId, number>;
  /** Personnage → taux de réussite, pour repérer « l'indice incompris ». */
  successRateByIdentity: Record<IdentityId, { rate: number; playerId: PlayerId }>;
}

export function computeCumulativeStats(input: CumulativeStatsInput): CumulativeStats {
  const correctGuessesByPlayer: Record<PlayerId, number> = {};
  const found: Record<PlayerId, number> = {};
  const possible: Record<PlayerId, number> = {};
  const successRateByIdentity: CumulativeStats['successRateByIdentity'] = {};

  for (const round of input.rounds) {
    const scores = scoreRound(round);
    const playerCount = Object.keys(round.slotByPlayer).length;
    const guessersPerPlayer = Math.max(1, playerCount - 1);

    for (const score of Object.values(scores)) {
      correctGuessesByPlayer[score.playerId] =
        (correctGuessesByPlayer[score.playerId] ?? 0) + score.guessed;

      found[score.playerId] = (found[score.playerId] ?? 0) + score.given;
      possible[score.playerId] = (possible[score.playerId] ?? 0) + guessersPerPlayer;

      const identityId = round.identityByPlayer[score.playerId];
      if (identityId) {
        successRateByIdentity[identityId] = {
          rate: score.given / guessersPerPlayer,
          playerId: score.playerId,
        };
      }
    }
  }

  const successRateByPlayer: Record<PlayerId, number> = {};
  for (const playerId of Object.keys(possible)) {
    const total = possible[playerId] ?? 0;
    successRateByPlayer[playerId] = total === 0 ? 0 : (found[playerId] ?? 0) / total;
  }

  return { correctGuessesByPlayer, successRateByPlayer, successRateByIdentity };
}
