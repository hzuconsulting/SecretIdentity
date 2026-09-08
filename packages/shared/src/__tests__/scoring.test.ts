import { describe, expect, it } from 'vitest';
import {
  computeCumulativeStats,
  maxRoundScore,
  scoreRound,
  type RoundScoringInput,
} from '../scoring';

/**
 * Helper : construit une manche à N joueurs (p1…pN) avec les étiquettes A, B, C…
 * `guesses` est indexé par joueur : { p1: { B: 'id-de-p2' } }.
 */
function buildRound(
  playerCount: number,
  guesses: Record<string, Record<string, string>>,
): RoundScoringInput {
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const labelMap: Record<string, string> = {};
  const identityByPlayer: Record<string, string> = {};

  for (let i = 0; i < playerCount; i++) {
    const playerId = `p${i + 1}`;
    labelMap[labels[i]!] = playerId;
    identityByPlayer[playerId] = `identity-${i + 1}`;
  }

  return { labelMap, identityByPlayer, guessesByPlayer: guesses };
}

describe('scoreRound — 3 joueurs', () => {
  it('donne 0 partout quand personne ne trouve', () => {
    const round = buildRound(3, {
      p1: { B: 'identity-3', C: 'identity-2' },
      p2: { A: 'identity-3', C: 'identity-1' },
      p3: { A: 'identity-2', B: 'identity-1' },
    });

    const scores = scoreRound(round);

    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(scores[playerId]).toMatchObject({ given: 0, guessed: 0, total: 0 });
    }
  });

  it('donne le maximum quand tout le monde trouve tout', () => {
    const round = buildRound(3, {
      p1: { B: 'identity-2', C: 'identity-3' },
      p2: { A: 'identity-1', C: 'identity-3' },
      p3: { A: 'identity-1', B: 'identity-2' },
    });

    const scores = scoreRound(round);

    for (const playerId of ['p1', 'p2', 'p3']) {
      expect(scores[playerId]).toMatchObject({ given: 2, guessed: 2, total: 4 });
    }
    expect(maxRoundScore(3)).toBe(4);
  });

  it('gère les réponses partielles', () => {
    // p1 trouve p2 mais pas p3 ; p2 ne répond rien ; p3 trouve p1.
    const round = buildRound(3, {
      p1: { B: 'identity-2', C: 'identity-1' },
      p2: {},
      p3: { A: 'identity-1', B: 'identity-1' },
    });

    const scores = scoreRound(round);

    expect(scores.p1).toMatchObject({ guessed: 1, given: 1, total: 2 });
    expect(scores.p2).toMatchObject({ guessed: 0, given: 1, total: 1 });
    expect(scores.p3).toMatchObject({ guessed: 1, given: 0, total: 1 });
  });

  it('ignore une réponse portant sur sa propre étiquette', () => {
    const round = buildRound(3, {
      p1: { A: 'identity-1', B: 'identity-2' },
    });

    const scores = scoreRound(round);

    // Seul B compte : A est sa propre série.
    expect(scores.p1!.guessed).toBe(1);
    expect(scores.p1!.given).toBe(0);
  });

  it('ignore une étiquette inconnue', () => {
    const round = buildRound(3, { p1: { Z: 'identity-2' } });
    expect(scoreRound(round).p1).toMatchObject({ guessed: 0, given: 0 });
  });
});

describe('scoreRound — 8 joueurs', () => {
  it('plafonne à N−1 dans chaque colonne', () => {
    const guesses: Record<string, Record<string, string>> = {};
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    for (let i = 0; i < 8; i++) {
      const guesser = `p${i + 1}`;
      guesses[guesser] = {};
      for (let j = 0; j < 8; j++) {
        if (i === j) continue;
        guesses[guesser]![labels[j]!] = `identity-${j + 1}`;
      }
    }

    const scores = scoreRound(buildRound(8, guesses));

    for (let i = 0; i < 8; i++) {
      expect(scores[`p${i + 1}`]).toMatchObject({ given: 7, guessed: 7, total: 14 });
    }
    expect(maxRoundScore(8)).toBe(14);
  });
});

describe('scoreRound — robustesse', () => {
  it('ignore les réponses d’un joueur absent du round', () => {
    const round = buildRound(3, { fantome: { A: 'identity-1' } });
    const scores = scoreRound(round);
    expect(scores.fantome).toBeUndefined();
    expect(scores.p1!.given).toBe(0);
  });

  it('n’a pas d’effet de bord sur l’entrée', () => {
    const round = buildRound(3, { p1: { B: 'identity-2' } });
    const snapshot = JSON.stringify(round);
    scoreRound(round);
    expect(JSON.stringify(round)).toBe(snapshot);
  });
});

describe('computeCumulativeStats', () => {
  it('agrège les bonnes réponses et les taux de réussite sur plusieurs manches', () => {
    const round1 = buildRound(3, {
      p1: { B: 'identity-2', C: 'identity-3' },
      p2: { A: 'identity-1', C: 'identity-3' },
      p3: { A: 'identity-1', B: 'identity-2' },
    });
    const round2 = buildRound(3, {
      p1: {},
      p2: {},
      p3: {},
    });

    const stats = computeCumulativeStats({ rounds: [round1, round2] });

    expect(stats.correctGuessesByPlayer.p1).toBe(2);
    // p1 a été trouvé 2 fois sur 4 occasions (2 manches × 2 devineurs).
    expect(stats.successRateByPlayer.p1).toBeCloseTo(0.5);
  });
});
