import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  HAND_CATEGORY_QUOTAS,
  MAX_PLAYERS,
  STARTING_HAND_CARDS,
  TOTAL_ROUNDS,
} from '../constants';
import { ICONS, ICON_BY_ID, getIcon } from '../data/icons';
import { IDENTITIES, IDENTITY_BY_ID, getIdentityPool } from '../data/identities';
import { cardFaces, dealHand, dealPictoCards } from '../dealHand';
import {
  generateGameCode,
  generateUniqueGameCode,
  isValidGameCode,
  normalizeGameCode,
} from '../gameCode';
import { drawIdentities, filterByDifficulty } from '../identityPool';
import { seededRng } from '../rng';
import type { IconCategory } from '../types';

describe('catalogue d’identités', () => {
  it('contient au moins 200 identités', () => {
    expect(IDENTITIES.length).toBeGreaterThanOrEqual(200);
  });

  it('n’a aucun identifiant en double', () => {
    expect(IDENTITY_BY_ID.size).toBe(IDENTITIES.length);
  });

  it('n’a aucun nom en double', () => {
    const names = new Set(IDENTITIES.map((i) => i.name.toLowerCase()));
    expect(names.size).toBe(IDENTITIES.length);
  });

  it('respecte grossièrement la répartition 45 / 40 / 15', () => {
    const count = (d: string) => IDENTITIES.filter((i) => i.difficulty === d).length;
    const total = IDENTITIES.length;

    expect(count('easy') / total).toBeGreaterThan(0.4);
    expect(count('medium') / total).toBeGreaterThan(0.3);
    expect(count('hard') / total).toBeGreaterThan(0.1);
  });

  it('couvre toutes les catégories', () => {
    const categories = new Set(IDENTITIES.map((i) => i.category));
    expect(categories.size).toBe(11);
  });

  it('fournit assez d’identités par difficulté pour une partie de 8 joueurs sur 10 manches', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const pool = filterByDifficulty(IDENTITIES, difficulty);
      expect(pool.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    }
  });

  it('expose des packs qui filtrent réellement', () => {
    const disney = getIdentityPool(['disney']);
    expect(disney.length).toBeGreaterThan(0);
    expect(disney.every((i) => i.category === 'disney')).toBe(true);
    expect(getIdentityPool().length).toBe(IDENTITIES.length);
  });
});

describe('catalogue d’icônes', () => {
  it('contient au moins 250 icônes', () => {
    expect(ICONS.length).toBeGreaterThanOrEqual(250);
  });

  it('n’a aucun identifiant ni aucun emoji en double', () => {
    expect(ICON_BY_ID.size).toBe(ICONS.length);
    expect(new Set(ICONS.map((i) => i.icon)).size).toBe(ICONS.length);
  });

  it('donne un label et des mots-clés à chaque icône', () => {
    for (const icon of ICONS) {
      expect(icon.label.length).toBeGreaterThan(0);
      expect(icon.keywords.length).toBeGreaterThan(0);
    }
  });

  it('a assez d’icônes dans chaque catégorie sous quota', () => {
    for (const [category, quota] of Object.entries(HAND_CATEGORY_QUOTAS)) {
      const available = ICONS.filter((i) => i.category === (category as IconCategory));
      expect(available.length).toBeGreaterThanOrEqual(quota);
    }
  });
});

describe('dealHand', () => {
  it('rend exactement handSize icônes, sans doublon', () => {
    for (const handSize of [8, 10, 12]) {
      const hand = dealHand({ handSize }, seededRng(42));
      expect(hand).toHaveLength(handSize);
      expect(new Set(hand).size).toBe(handSize);
    }
  });

  it('respecte les quotas par catégorie', () => {
    for (let seed = 0; seed < 50; seed++) {
      const hand = dealHand({ handSize: 8 }, seededRng(seed));
      const categories = hand.map((id) => getIcon(id)!.category);

      for (const [category, quota] of Object.entries(HAND_CATEGORY_QUOTAS)) {
        const found = categories.filter((c) => c === (category as IconCategory)).length;
        expect(found, `graine ${seed}, catégorie ${category}`).toBeGreaterThanOrEqual(quota);
      }
    }
  });

  it('est déterministe à graine égale', () => {
    const a = dealHand({ handSize: 10 }, seededRng(7));
    const b = dealHand({ handSize: 10 }, seededRng(7));
    expect(a).toEqual(b);
  });

  it('produit des mains différentes à graines différentes', () => {
    const a = dealHand({ handSize: 10 }, seededRng(1));
    const b = dealHand({ handSize: 10 }, seededRng(2));
    expect(a).not.toEqual(b);
  });

  it('ne rend que des identifiants d’icônes existants', () => {
    const hand = dealHand({ handSize: 12 }, seededRng(99));
    for (const id of hand) expect(getIcon(id)).toBeDefined();
  });

  it('échoue franchement si le catalogue est trop petit', () => {
    expect(() => dealHand({ handSize: 10, pool: ICONS.slice(0, 3) }, seededRng(1))).toThrow();
  });
});

describe('drawIdentities', () => {
  it('rend des identités distinctes', () => {
    const { identities } = drawIdentities(
      { count: 8, difficulty: 'mixed', usedIdentityIds: new Set() },
      seededRng(3),
    );
    expect(identities).toHaveLength(8);
    expect(new Set(identities.map((i) => i.id)).size).toBe(8);
  });

  it('respecte le filtre de difficulté', () => {
    const { identities } = drawIdentities(
      { count: 6, difficulty: 'hard', usedIdentityIds: new Set() },
      seededRng(4),
    );
    expect(identities.every((i) => i.difficulty === 'hard')).toBe(true);
  });

  it('ne réutilise pas une identité déjà sortie', () => {
    const used = new Set<string>();
    const rng = seededRng(11);

    for (let round = 0; round < 5; round++) {
      const { identities, poolReset } = drawIdentities(
        { count: 4, difficulty: 'mixed', usedIdentityIds: used },
        rng,
      );
      expect(poolReset).toBe(false);
      for (const identity of identities) {
        expect(used.has(identity.id)).toBe(false);
        used.add(identity.id);
      }
    }
  });

  it('réinitialise le pool de façon contrôlée quand il est épuisé', () => {
    const hardPool = filterByDifficulty(IDENTITIES, 'hard');
    const used = new Set(hardPool.map((i) => i.id));

    const { identities, poolReset } = drawIdentities(
      { count: 4, difficulty: 'hard', usedIdentityIds: used },
      seededRng(5),
    );

    expect(poolReset).toBe(true);
    expect(new Set(identities.map((i) => i.id)).size).toBe(4);
  });

  it('échoue si le pool est structurellement trop petit', () => {
    expect(() =>
      drawIdentities(
        { count: 999, difficulty: 'hard', usedIdentityIds: new Set() },
        seededRng(1),
      ),
    ).toThrow();
  });
});

describe('codes de partie', () => {
  it('génère un code de 5 caractères non ambigus', () => {
    const code = generateGameCode(seededRng(1));
    expect(code).toHaveLength(5);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
  });

  it('ne contient jamais 0, O, 1 ni I', () => {
    const rng = seededRng(123);
    for (let i = 0; i < 2000; i++) {
      expect(generateGameCode(rng)).not.toMatch(/[0O1I]/);
    }
  });

  it('évite les collisions avec les codes déjà pris', () => {
    const rng = seededRng(8);
    const taken = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = generateUniqueGameCode(rng, taken);
      expect(taken.has(code)).toBe(false);
      taken.add(code);
    }
    expect(taken.size).toBe(500);
  });

  it('normalise la saisie utilisateur', () => {
    expect(normalizeGameCode(' k7p-4q ')).toBe('K7P4Q');
    expect(isValidGameCode('k7p4q')).toBe(true);
    expect(isValidGameCode('K7P4')).toBe(false);
    expect(isValidGameCode('K7P4O')).toBe(false);
  });
});


describe('dealPictoCards', () => {
  it('rend le bon nombre de cartes, à deux faces distinctes', () => {
    const cards = dealPictoCards({ cardCount: STARTING_HAND_CARDS }, seededRng(3));

    expect(cards).toHaveLength(STARTING_HAND_CARDS);
    for (const card of cards) {
      expect(card.front).not.toBe(card.back);
      expect(cardFaces(card)).toEqual([card.front, card.back]);
    }
  });

  it('n’utilise jamais deux fois le même pictogramme dans une main', () => {
    const cards = dealPictoCards({ cardCount: STARTING_HAND_CARDS }, seededRng(11));
    const faces = cards.flatMap(cardFaces);

    expect(new Set(faces).size).toBe(STARTING_HAND_CARDS * 2);
  });

  it('donne des identifiants uniques, préfixables par joueur', () => {
    const cards = dealPictoCards({ cardCount: 4, idPrefix: 'p1-' }, seededRng(5));

    expect(cards.map((card) => card.id)).toEqual(['p1-c1', 'p1-c2', 'p1-c3', 'p1-c4']);
  });

  it('est déterministe à graine fixée, et varie sinon', () => {
    const a = dealPictoCards({ cardCount: 6 }, seededRng(7));
    const b = dealPictoCards({ cardCount: 6 }, seededRng(7));
    const c = dealPictoCards({ cardCount: 6 }, seededRng(8));

    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('échoue plutôt que de rendre une main incomplète', () => {
    expect(() =>
      dealPictoCards({ cardCount: 10, pool: ICONS.slice(0, 5) }, seededRng(1)),
    ).toThrow();
  });
});

describe('le catalogue suffit aux règles', () => {
  it('offre assez de personnages pour une partie entière, dans chaque difficulté', () => {
    const pool = getIdentityPool(['base']);

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const available = filterByDifficulty(pool, difficulty);
      // 4 manches × 8 personnages, sans jamais réutiliser.
      expect(available.length, difficulty).toBeGreaterThanOrEqual(TOTAL_ROUNDS * BOARD_SIZE);
    }
  });

  it('offre assez de pictogrammes pour huit mains complètes', () => {
    expect(ICONS.length).toBeGreaterThanOrEqual(MAX_PLAYERS * STARTING_HAND_CARDS * 2);
  });
});
