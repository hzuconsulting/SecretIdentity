import { CODE_ALPHABET, CODE_LENGTH } from './constants';
import { randomInt, type Rng } from './rng';

/**
 * Codes de partie.
 *
 * L'alphabet exclut 0/O et 1/I : un code se lit à voix haute dans une pièce
 * bruyante et se retape sur un clavier de téléphone.
 */

export function generateGameCode(rng: Rng): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(rng, CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Génère un code absent de `taken`.
 * Sur 32^5 ≈ 33 millions de combinaisons, la collision est improbable, mais
 * on boucle quand même — et on échoue bruyamment plutôt que silencieusement.
 */
export function generateUniqueGameCode(
  rng: Rng,
  taken: ReadonlySet<string>,
  maxAttempts = 50,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateGameCode(rng);
    if (!taken.has(code)) return code;
  }
  throw new Error('generateUniqueGameCode: impossible de générer un code libre');
}

/** Normalise une saisie utilisateur : majuscules, sans espace ni tiret. */
export function normalizeGameCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidGameCode(input: string): boolean {
  const code = normalizeGameCode(input);
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((char) => CODE_ALPHABET.includes(char));
}
