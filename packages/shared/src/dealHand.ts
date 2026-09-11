import { HAND_CATEGORY_QUOTAS } from './constants';
import { ICONS, ICONS_BY_CATEGORY } from './data/icons';
import { shuffle, type Rng } from './rng';
import type { GameIcon, IconCategory, IconId, PictoCard } from './types';

/** Pictogrammes portés par une carte : deux par face, deux faces. */
export const ICONS_PER_CARD = 4;

/**
 * Distribution d'une main de pictogrammes.
 *
 * Une main tirée totalement au hasard est souvent injouable (dix symboles
 * abstraits, aucun objet concret). On impose donc des quotas minimaux par
 * catégorie, puis on complète librement (§8.3).
 *
 * Les mains de deux joueurs **peuvent** se recouper : c'est voulu, ça crée
 * l'ambiguïté qui fait l'intérêt du jeu.
 *
 * Fonctions pures et déterministes à RNG fixé.
 */

export interface DealHandOptions {
  handSize: number;
  /** Permet d'injecter un catalogue réduit dans les tests. */
  pool?: readonly GameIcon[];
}

export interface DealPictoCardsOptions {
  cardCount: number;
  /**
   * Préfixe des identifiants de cartes.
   *
   * Les identifiants n'ont besoin d'être uniques que dans la main d'un joueur —
   * la validation ne cherche jamais ailleurs. Mais deux joueurs qui possèdent
   * chacun une carte « c3 » rendent illisibles les journaux, les tests et les
   * clés de rendu, pour rien : on préfixe par le joueur.
   */
  idPrefix?: string;
  /** Permet d'injecter un catalogue réduit dans les tests. */
  pool?: readonly GameIcon[];
}

/**
 * Distribue les cartes Picto d'un joueur pour **toute la partie**.
 *
 * Chaque carte porte quatre pictogrammes, deux par face : on tire donc quatre
 * fois plus d'icônes que de cartes, sans doublon dans la main, puis on les
 * groupe. Le regroupement est aveugle, et c'est ce qui crée les dilemmes — la
 * bonne image partage régulièrement sa carte avec une autre bonne image, et il
 * faudra choisir laquelle sacrifier.
 */
export function dealPictoCards(options: DealPictoCardsOptions, rng: Rng): PictoCard[] {
  const { cardCount } = options;
  if (cardCount <= 0) return [];

  const icons = dealHand(
    { handSize: cardCount * ICONS_PER_CARD, ...(options.pool ? { pool: options.pool } : {}) },
    rng,
  );

  const cards: PictoCard[] = [];
  for (let index = 0; index < cardCount; index++) {
    const [a, b, c, d] = icons.slice(index * ICONS_PER_CARD, (index + 1) * ICONS_PER_CARD);
    if (!a || !b || !c || !d) throw new Error('dealPictoCards: icônes insuffisantes');
    cards.push({ id: `${options.idPrefix ?? ''}c${index + 1}`, front: [a, b], back: [c, d] });
  }

  return cards;
}

/**
 * Les quatre pictogrammes d'une carte : recto puis verso.
 *
 * Seul point d'accès pour savoir si un pictogramme est « sur la carte » : la
 * validation, le tirage automatique et l'affichage passent tous par ici.
 */
export function cardIcons(card: PictoCard): IconId[] {
  return [...card.front, ...card.back];
}

export function dealHand(options: DealHandOptions, rng: Rng): IconId[] {
  const { handSize } = options;
  const pool = options.pool ?? ICONS;

  if (handSize <= 0) return [];
  if (pool.length < handSize) {
    throw new Error(
      `dealHand: catalogue trop petit (${pool.length} icônes pour une main de ${handSize})`,
    );
  }

  const byCategory = options.pool ? groupByCategory(options.pool) : ICONS_BY_CATEGORY;

  const picked = new Set<IconId>();

  // 1. Quotas obligatoires.
  for (const [category, quota] of Object.entries(HAND_CATEGORY_QUOTAS)) {
    const candidates = byCategory[category as IconCategory] ?? [];
    const chosen = shuffle(rng, candidates).slice(0, Math.min(quota, handSize - picked.size));
    for (const icon of chosen) picked.add(icon.id);
    if (picked.size >= handSize) break;
  }

  // 2. Complément libre, sans doublon.
  if (picked.size < handSize) {
    const remaining = shuffle(
      rng,
      pool.filter((icon) => !picked.has(icon.id)),
    );
    for (const icon of remaining) {
      if (picked.size >= handSize) break;
      picked.add(icon.id);
    }
  }

  // 3. Mélange final : les quotas ne doivent pas être devinables par la position.
  return shuffle(rng, [...picked]);
}

function groupByCategory(pool: readonly GameIcon[]): Record<IconCategory, GameIcon[]> {
  const result: Record<IconCategory, GameIcon[]> = {
    objet: [],
    animal: [],
    nourriture: [],
    lieu: [],
    symbole: [],
    action: [],
    nature: [],
    personne: [],
  };
  for (const icon of pool) result[icon.category].push(icon);
  return result;
}
