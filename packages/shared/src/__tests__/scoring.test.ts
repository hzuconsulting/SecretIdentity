import { describe, expect, it } from 'vitest';
import {
  computeCumulativeStats,
  leadersOf,
  maxRoundScore,
  scoreRound,
  type CumulativeRoundInput,
  type RoundScoringInput,
} from '../scoring';
import type { RoundScoreLine } from '../types';

/**
 * Helper : une manche à N joueurs (p1…pN), où pᵢ porte le numéro i.
 * `votes` est indexé par votant : { p1: { p2: 2 } } — « p1 pense que p2 est le 2 ».
 */
function buildRound(
  playerCount: number,
  votes: Record<string, Record<string, number>>,
): RoundScoringInput {
  const slotByPlayer: Record<string, number> = {};

  for (let i = 0; i < playerCount; i++) {
    slotByPlayer[`p${i + 1}`] = i + 1;
  }

  return { slotByPlayer, votesByPlayer: votes };
}

/** La même manche, augmentée des personnages, pour les statistiques cumulées. */
function withIdentities(round: RoundScoringInput): CumulativeRoundInput {
  const identityByPlayer: Record<string, string> = {};
  for (const [playerId, slot] of Object.entries(round.slotByPlayer)) {
    identityByPlayer[playerId] = `identity-${slot}`;
  }
  return { ...round, identityByPlayer };
}

describe('scoreRound — 3 joueurs', () => {
  it('donne 0 partout quand personne ne trouve', () => {
    const round = buildRound(3, {
      p1: { p2: 3, p3: 2 },
      p2: { p1: 3, p3: 1 },
      p3: { p1: 2, p2: 1 },
    });

    const scores = scoreRound(round);

    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(scores[playerId]).toMatchObject({ given: 0, guessed: 0, total: 0 });
    }
  });

  it('donne le maximum quand tout le monde trouve tout', () => {
    const round = buildRound(3, {
      p1: { p2: 2, p3: 3 },
      p2: { p1: 1, p3: 3 },
      p3: { p1: 1, p2: 2 },
    });

    const scores = scoreRound(round);

    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(scores[playerId]).toMatchObject({ given: 2, guessed: 2, total: 4 });
    }
    expect(maxRoundScore(3)).toBe(4);
  });

  it('gère les votes partiels', () => {
    // p1 trouve p2 mais pas p3 ; p2 ne vote pas ; p3 trouve p1.
    const round = buildRound(3, {
      p1: { p2: 2, p3: 1 },
      p2: {},
      p3: { p1: 1, p2: 1 },
    });

    const scores = scoreRound(round);

    expect(scores.p1).toMatchObject({ guessed: 1, given: 1, total: 2 });
    expect(scores.p2).toMatchObject({ guessed: 0, given: 1, total: 1 });
    expect(scores.p3).toMatchObject({ guessed: 1, given: 0, total: 1 });
  });

  it('ignore un vote pour soi-même', () => {
    const round = buildRound(3, {
      p1: { p1: 1, p2: 2 },
    });

    const scores = scoreRound(round);

    // Seul le vote pour p2 compte : voter pour soi ne rapporte rien.
    expect(scores.p1!.guessed).toBe(1);
    expect(scores.p1!.given).toBe(0);
  });

  it('ignore un vote pour un joueur inconnu', () => {
    const round = buildRound(3, { p1: { fantome: 2 } });
    expect(scoreRound(round).p1).toMatchObject({ guessed: 0, given: 0 });
  });

  it('ne rapporte rien pour un vote sur un leurre', () => {
    // Le numéro 7 existe sur le plateau, mais personne ne le porte.
    const round = buildRound(3, { p1: { p2: 7 } });
    expect(scoreRound(round).p1!.guessed).toBe(0);
    expect(scoreRound(round).p2!.given).toBe(0);
  });
});

describe('scoreRound — 2 joueurs', () => {
  /**
   * À deux, chaque bonne réponse rapporte un point à chacun : l'un pour avoir
   * trouvé, l'autre pour s'être fait deviner. Les totaux sont donc toujours
   * égaux, et ce sont les cartes gardées qui départagent.
   */
  it.each([
    ['personne ne trouve', { p1: { p2: 5 }, p2: { p1: 6 } }, 0],
    ['seul p1 trouve', { p1: { p2: 2 }, p2: { p1: 6 } }, 1],
    ['seul p2 trouve', { p1: { p2: 5 }, p2: { p1: 1 } }, 1],
    ['les deux trouvent', { p1: { p2: 2 }, p2: { p1: 1 } }, 2],
  ])('donne le même total aux deux quand %s', (_, votes, total) => {
    const scores = scoreRound(buildRound(2, votes));

    expect(scores.p1!.total).toBe(total);
    expect(scores.p2!.total).toBe(total);
  });

  it('plafonne à 2 points par manche', () => {
    expect(maxRoundScore(2)).toBe(2);
  });
});

describe('scoreRound — 8 joueurs', () => {
  it('plafonne à N−1 dans chaque colonne', () => {
    const votes: Record<string, Record<string, number>> = {};

    for (let i = 0; i < 8; i++) {
      const voter = `p${i + 1}`;
      votes[voter] = {};
      for (let j = 0; j < 8; j++) {
        if (i === j) continue;
        votes[voter]![`p${j + 1}`] = j + 1;
      }
    }

    const scores = scoreRound(buildRound(8, votes));

    for (let i = 0; i < 8; i++) {
      expect(scores[`p${i + 1}`]).toMatchObject({ given: 7, guessed: 7, total: 14 });
    }
    expect(maxRoundScore(8)).toBe(14);
  });
});

describe('scoreRound — robustesse', () => {
  it('ignore les votes d’un joueur absent de la manche', () => {
    const round = buildRound(3, { fantome: { p1: 1 } });
    const scores = scoreRound(round);
    expect(scores.fantome).toBeUndefined();
    expect(scores.p1!.given).toBe(0);
  });

  it('n’a pas d’effet de bord sur l’entrée', () => {
    const round = buildRound(3, { p1: { p2: 2 } });
    const snapshot = JSON.stringify(round);
    scoreRound(round);
    expect(JSON.stringify(round)).toBe(snapshot);
  });
});

describe('computeCumulativeStats', () => {
  it('agrège les bonnes réponses et les taux de réussite sur plusieurs manches', () => {
    const round1 = withIdentities(
      buildRound(3, {
        p1: { p2: 2, p3: 3 },
        p2: { p1: 1, p3: 3 },
        p3: { p1: 1, p2: 2 },
      }),
    );
    const round2 = withIdentities(buildRound(3, { p1: {}, p2: {}, p3: {} }));

    const stats = computeCumulativeStats({ rounds: [round1, round2] });

    expect(stats.correctGuessesByPlayer.p1).toBe(2);
    // p1 a été trouvé 2 fois sur 4 occasions (2 manches × 2 votants).
    expect(stats.successRateByPlayer.p1).toBeCloseTo(0.5);
  });
});

describe('leadersOf', () => {
  const line = (
    playerId: string,
    cumulative: number,
    cardsLeft: number,
  ): RoundScoreLine => ({
    playerId,
    nickname: playerId,
    given: 0,
    guessed: 0,
    total: 0,
    cumulative,
    cardsLeft,
  });

  it('départage à égalité de points par les cartes restantes', () => {
    const standings = [line('p1', 8, 5), line('p2', 8, 3)];
    expect(leadersOf(standings)).toEqual(['p1']);
  });

  it('rend une victoire partagée quand les deux critères sont à égalité', () => {
    const standings = [line('p1', 8, 5), line('p2', 8, 5), line('p3', 4, 9)];
    expect(leadersOf(standings)).toEqual(['p1', 'p2']);
  });

  it('rend une liste vide sur un classement vide', () => {
    expect(leadersOf([])).toEqual([]);
  });
});
