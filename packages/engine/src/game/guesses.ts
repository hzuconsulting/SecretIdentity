import { BOARD_SIZE, type GameErrorCode, type PlayerId, type Slot } from '@identite-secrete/shared';

/**
 * Validation d'un jeu de votes.
 *
 * Les règles du livret, appliquées côté hôte parce qu'un client modifié
 * pourrait toutes les contourner :
 *  - on vote pour ses **adversaires**, jamais pour soi ;
 *  - le numéro proposé existe sur le plateau (1 à `BOARD_SIZE`) ;
 *  - **un numéro ne sert qu'une fois** : chaque joueur n'a qu'une seule carte
 *    Vote de chaque chiffre.
 *
 * Les réponses **partielles sont acceptées**. L'interface, elle, n'autorise la
 * validation manuelle que lorsque toutes les cases sont remplies ; mais à
 * l'expiration du minuteur le client envoie ce qu'il a, et une case vide doit
 * pouvoir rester vide (= vote perdu) plutôt que d'être remplie au hasard.
 *
 * Fonction pure : testable sans réseau ni partie en mémoire.
 */

export type VoteValidation =
  | { ok: true; votes: Record<PlayerId, Slot> }
  | { ok: false; code: GameErrorCode; message?: string };

export function validateVotes(
  votes: Record<string, number>,
  opponentIds: readonly PlayerId[],
): VoteValidation {
  const allowed = new Set(opponentIds);
  const entries = Object.entries(votes);

  if (entries.length > opponentIds.length) {
    return {
      ok: false,
      code: 'INVALID_GUESS',
      message: 'Il y a plus de votes que d’adversaires.',
    };
  }

  for (const [targetId, slot] of entries) {
    if (!allowed.has(targetId)) {
      return {
        ok: false,
        code: 'INVALID_GUESS',
        message: 'Tu ne peux voter que pour les autres joueurs.',
      };
    }

    if (!Number.isInteger(slot) || slot < 1 || slot > BOARD_SIZE) {
      return {
        ok: false,
        code: 'INVALID_GUESS',
        message: 'Ce numéro n’est pas sur le plateau.',
      };
    }
  }

  const used = entries.map(([, slot]) => slot);
  if (new Set(used).size !== used.length) {
    return {
      ok: false,
      code: 'INVALID_GUESS',
      message: 'Tu n’as qu’une carte Vote par numéro.',
    };
  }

  return { ok: true, votes: Object.fromEntries(entries) };
}

/** Deux jeux de votes identiques. */
export function sameVotes(
  a: Record<PlayerId, Slot>,
  b: Record<PlayerId, Slot>,
): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((playerId) => a[playerId] === b[playerId]);
}
