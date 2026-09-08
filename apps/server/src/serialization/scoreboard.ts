import {
  computeCumulativeStats,
  getIdentity,
  type Game,
  type GameStats,
  type PlayerId,
  type Round,
  type RoundScoreLine,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from '../game/factory';

/**
 * Classements et statistiques de fin de partie.
 *
 * Extrait de `playerView.ts` pour que ce dernier reste ce qu'il doit être : la
 * liste, phase par phase, de ce qui a le droit de sortir vers un socket. Ici on
 * ne décide de rien — tout ce qui est calculé l'est à partir de données déjà
 * jugées publiques par l'appelant.
 */

/**
 * Classement cumulé, décroissant.
 * `round` sert à afficher les points gagnés dans la manche écoulée.
 */
export function buildStandings(game: Game, round: Round | null): RoundScoreLine[] {
  const lines: RoundScoreLine[] = [];

  for (const player of playersInJoinOrder(game)) {
    const assignment = round?.assignments.get(player.id) ?? null;
    const given = assignment?.roundScoreGiven ?? 0;
    const guessed = assignment?.roundScoreGuessed ?? 0;

    lines.push({
      playerId: player.id,
      nickname: player.nickname,
      given,
      guessed,
      total: given + guessed,
      cumulative: player.score,
    });
  }

  return lines.sort((a, b) => b.cumulative - a.cumulative);
}

/** Statistiques de fin de partie, calculées sur toutes les manches jouées. */
export function buildStats(game: Game): GameStats {
  const rounds = game.rounds.map((round) => {
    const identityByPlayer: Record<string, string> = {};
    const guessesByPlayer: Record<string, Record<string, string>> = {};

    for (const [playerId, assignment] of round.assignments) {
      identityByPlayer[playerId] = assignment.identityId;
      guessesByPlayer[playerId] = assignment.guesses;
    }

    return { labelMap: round.labelMap, identityByPlayer, guessesByPlayer };
  });

  const stats = computeCumulativeStats({ rounds });
  const nicknameOf = (playerId: PlayerId) =>
    game.players.get(playerId)?.nickname ?? 'Joueur parti';

  const bestDetective = bestEntry(stats.correctGuessesByPlayer);
  const bestCluegiver = bestEntry(stats.successRateByPlayer);

  let hardestIdentity: GameStats['hardestIdentity'] = null;
  for (const [identityId, entry] of Object.entries(stats.successRateByIdentity)) {
    if (hardestIdentity === null || entry.rate < hardestIdentity.successRate) {
      hardestIdentity = {
        identityId,
        nickname: getIdentity(identityId)?.name ?? identityId,
        successRate: entry.rate,
      };
    }
  }

  return {
    bestDetective: bestDetective
      ? {
          playerId: bestDetective.key,
          nickname: nicknameOf(bestDetective.key),
          correctGuesses: bestDetective.value,
        }
      : null,
    bestCluegiver: bestCluegiver
      ? {
          playerId: bestCluegiver.key,
          nickname: nicknameOf(bestCluegiver.key),
          successRate: bestCluegiver.value,
        }
      : null,
    hardestIdentity,
  };
}

function bestEntry(values: Record<string, number>): { key: string; value: number } | null {
  let best: { key: string; value: number } | null = null;

  for (const [key, value] of Object.entries(values)) {
    if (best === null || value > best.value) best = { key, value };
  }

  return best;
}

