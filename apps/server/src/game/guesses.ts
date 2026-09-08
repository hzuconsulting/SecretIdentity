import type { GameErrorCode, IdentityId, Label } from '@identite-secrete/shared';

/**
 * Validation d'une soumission de devinettes.
 *
 * Les règles tranchées du §3.1, appliquées côté serveur parce qu'un client
 * modifié pourrait toutes les contourner :
 *  - le joueur ne devine **jamais** sa propre série : son étiquette n'est pas
 *    dans les étiquettes autorisées ;
 *  - il ne peut proposer que des identités du sous-ensemble autorisé, qui
 *    exclut la sienne ;
 *  - une identité ne sert **qu'une fois** : l'appariement est une bijection.
 *
 * Les réponses **partielles sont acceptées**. L'interface, elle, n'autorise la
 * validation manuelle que lorsque toutes les cases sont remplies ; mais à
 * l'expiration du minuteur le client envoie ce qu'il a, et une case vide doit
 * pouvoir rester vide (= réponse fausse) plutôt que d'être perdue ou remplie
 * au hasard (§3.1).
 *
 * Fonction pure : testable sans réseau ni partie en mémoire.
 */

export type GuessValidation =
  | { ok: true; guesses: Record<Label, IdentityId> }
  | { ok: false; code: GameErrorCode; message?: string };

export function validateGuessSubmission(
  guesses: Record<string, string>,
  allowedLabels: readonly Label[],
  allowedIdentityIds: readonly IdentityId[],
): GuessValidation {
  const labels = new Set(allowedLabels);
  const identities = new Set(allowedIdentityIds);
  const entries = Object.entries(guesses);

  if (entries.length > allowedLabels.length) {
    return {
      ok: false,
      code: 'INVALID_GUESS',
      message: 'Il y a plus de réponses que de séries à deviner.',
    };
  }

  for (const [label, identityId] of entries) {
    if (!labels.has(label)) {
      return {
        ok: false,
        code: 'INVALID_GUESS',
        message: `La série ${label} ne fait pas partie de celles que tu dois deviner.`,
      };
    }

    if (!identities.has(identityId)) {
      return {
        ok: false,
        code: 'INVALID_GUESS',
        message: 'Cette identité ne fait pas partie des choix proposés.',
      };
    }
  }

  const used = entries.map(([, identityId]) => identityId);
  if (new Set(used).size !== used.length) {
    return {
      ok: false,
      code: 'INVALID_GUESS',
      message: 'Une identité ne peut être attribuée qu’une seule fois.',
    };
  }

  return { ok: true, guesses: Object.fromEntries(entries) };
}

/** Deux jeux de réponses identiques. */
export function sameGuesses(
  a: Record<Label, IdentityId>,
  b: Record<Label, IdentityId>,
): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((label) => a[label] === b[label]);
}
