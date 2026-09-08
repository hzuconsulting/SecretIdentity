import type { IdentityId, Label, PlayerId } from './types';

/**
 * Calcul de score — **fonction pure**.
 *
 * Aucune dépendance à Socket.IO ni à l'état serveur : on entre des données
 * brutes, on sort des points. C'est ce qui rend la règle testable et
 * réutilisable côté client pour l'affichage.
 *
 * Règle (§3.2) :
 *  - « Faire deviner » : +1 par joueur ayant correctement identifié notre
 *    personnage. Maximum N−1.
 *  - « Deviner »       : +1 par identité correctement attribuée. Maximum N−1.
 *
 * Un joueur ne devine jamais sa propre série : toute réponse portant sur sa
 * propre étiquette est ignorée (elle ne peut pas rapporter de points).
 */

export interface RoundScoringInput {
  /** Étiquette anonyme → joueur qui l'a produite. */
  labelMap: Record<Label, PlayerId>;
  /** Joueur → identité qui lui a été attribuée pour la manche. */
  identityByPlayer: Record<PlayerId, IdentityId>;
  /**
   * Joueur → ses réponses (étiquette → identité devinée).
   * Une case non remplie est simplement absente : elle compte comme fausse.
   */
  guessesByPlayer: Record<PlayerId, Record<Label, IdentityId>>;
}

export interface PlayerRoundScore {
  playerId: PlayerId;
  /** Points « faire deviner ». */
  given: number;
  /** Points « bonnes réponses ». */
  guessed: number;
  /** given + guessed */
  total: number;
  /** Étiquettes correctement devinées par ce joueur. */
  correctLabels: Label[];
  /** Joueurs ayant correctement identifié ce joueur. */
  guessedByPlayerIds: PlayerId[];
}

export type RoundScores = Record<PlayerId, PlayerRoundScore>;

export function scoreRound(input: RoundScoringInput): RoundScores {
  const { labelMap, identityByPlayer, guessesByPlayer } = input;

  const playerIds = Object.keys(identityByPlayer);
  const scores: RoundScores = {};

  for (const playerId of playerIds) {
    scores[playerId] = {
      playerId,
      given: 0,
      guessed: 0,
      total: 0,
      correctLabels: [],
      guessedByPlayerIds: [],
    };
  }

  for (const [guesserId, guesses] of Object.entries(guessesByPlayer)) {
    const guesserScore = scores[guesserId];
    if (!guesserScore) continue; // joueur parti en cours de manche

    for (const [label, guessedIdentityId] of Object.entries(guesses)) {
      const ownerId = labelMap[label];
      if (!ownerId) continue; // étiquette inconnue → ignorée
      if (ownerId === guesserId) continue; // on ne devine jamais sa propre série

      const trueIdentityId = identityByPlayer[ownerId];
      if (!trueIdentityId || trueIdentityId !== guessedIdentityId) continue;

      guesserScore.guessed += 1;
      guesserScore.correctLabels.push(label);

      const ownerScore = scores[ownerId];
      if (ownerScore) {
        ownerScore.given += 1;
        ownerScore.guessedByPlayerIds.push(guesserId);
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

// ─────────────────────────────────────────────────────────────
//  Statistiques de fin de partie (§7.1, écran 10)
// ─────────────────────────────────────────────────────────────

export interface CumulativeStatsInput {
  /** Une entrée par manche jouée. */
  rounds: RoundScoringInput[];
}

export interface CumulativeStats {
  /** Joueur → nombre total d'identités correctement devinées. */
  correctGuessesByPlayer: Record<PlayerId, number>;
  /** Joueur → taux de réussite de SES propres indices, entre 0 et 1. */
  successRateByPlayer: Record<PlayerId, number>;
  /** Identité → taux de réussite, pour repérer « l'indice incompris ». */
  successRateByIdentity: Record<IdentityId, { rate: number; playerId: PlayerId }>;
}

export function computeCumulativeStats(input: CumulativeStatsInput): CumulativeStats {
  const correctGuessesByPlayer: Record<PlayerId, number> = {};
  const found: Record<PlayerId, number> = {};
  const possible: Record<PlayerId, number> = {};
  const successRateByIdentity: CumulativeStats['successRateByIdentity'] = {};

  for (const round of input.rounds) {
    const scores = scoreRound(round);
    const playerCount = Object.keys(round.identityByPlayer).length;
    const guessersPerLabel = Math.max(1, playerCount - 1);

    for (const score of Object.values(scores)) {
      correctGuessesByPlayer[score.playerId] =
        (correctGuessesByPlayer[score.playerId] ?? 0) + score.guessed;

      found[score.playerId] = (found[score.playerId] ?? 0) + score.given;
      possible[score.playerId] = (possible[score.playerId] ?? 0) + guessersPerLabel;

      const identityId = round.identityByPlayer[score.playerId];
      if (identityId) {
        successRateByIdentity[identityId] = {
          rate: score.given / guessersPerLabel,
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
