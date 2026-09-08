import { HAND_CATEGORY_QUOTAS } from './constants';
import { ICONS, ICONS_BY_CATEGORY } from './data/icons';
import { shuffle, type Rng } from './rng';
import type { GameIcon, IconCategory, IconId } from './types';

/**
 * Distribution d'une main d'icônes.
 *
 * Une main tirée totalement au hasard est souvent injouable (dix symboles
 * abstraits, aucun objet concret). On impose donc des quotas minimaux par
 * catégorie, puis on complète librement (§8.3).
 *
 * Les mains de deux joueurs **peuvent** se recouper : c'est voulu, ça crée
 * l'ambiguïté qui fait l'intérêt du jeu.
 *
 * Fonction pure et déterministe à RNG fixé.
 */

export interface DealHandOptions {
  handSize: number;
  /** Permet d'injecter un catalogue réduit dans les tests. */
  pool?: readonly GameIcon[];
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
