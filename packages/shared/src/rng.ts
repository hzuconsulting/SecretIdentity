/**
 * RNG injectable.
 *
 * Toute la logique de tirage du jeu (mains, identités, étiquettes, codes)
 * prend un `Rng` en paramètre. En production on passe `defaultRng`, en test
 * on passe un générateur déterministe → les fonctions deviennent testables
 * sans mock global.
 */
export type Rng = () => number;

export const defaultRng: Rng = () => Math.random();

/** Mulberry32 : petit PRNG déterministe, suffisant pour un jeu de soirée. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entier dans [0, max). */
export function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

/** Élément au hasard. Lève si le tableau est vide. */
export function pickOne<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickOne: tableau vide');
  }
  const item = items[randomInt(rng, items.length)];
  // `noUncheckedIndexedAccess` : l'index est borné, mais TypeScript ne le sait pas.
  return item as T;
}

/** Fisher-Yates. Retourne une **copie** mélangée. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** `count` éléments distincts, tirés au hasard. */
export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  return shuffle(rng, items).slice(0, count);
}
