import { MIN_CLUES, type GameErrorCode, type IconId, type Settings } from '@identite-secrete/shared';

/**
 * Validation d'une soumission d'indices.
 *
 * Zod a déjà vérifié la **forme** du payload (un tableau de chaînes non vide).
 * Ici on vérifie le **fond**, c'est-à-dire tout ce qui dépend de l'état du
 * joueur : les icônes lui appartiennent-elles, sont-elles distinctes, y en
 * a-t-il trop pour le réglage en cours.
 *
 * Fonction pure : c'est l'anti-triche du §6, et elle doit être testable sans
 * réseau ni partie en mémoire.
 */

export type ClueValidation =
  | { ok: true; iconIds: IconId[] }
  | { ok: false; code: GameErrorCode; message?: string };

export function validateClueSelection(
  iconIds: IconId[],
  hand: readonly IconId[],
  settings: Settings,
): ClueValidation {
  if (new Set(iconIds).size !== iconIds.length) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      message: 'Une icône ne peut pas être choisie deux fois.',
    };
  }

  if (iconIds.length < MIN_CLUES) {
    return { ok: false, code: 'NOT_ENOUGH_CLUES' };
  }

  if (iconIds.length > settings.maxClues) {
    return {
      ok: false,
      code: 'TOO_MANY_CLUES',
      message: `${settings.maxClues} indices maximum.`,
    };
  }

  const inHand = new Set(hand);
  if (!iconIds.every((iconId) => inHand.has(iconId))) {
    return { ok: false, code: 'ICON_NOT_IN_HAND' };
  }

  return { ok: true, iconIds: [...iconIds] };
}

/** Deux sélections identiques, quel que soit l'ordre. */
export function sameSelection(a: readonly IconId[], b: readonly IconId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((iconId) => set.has(iconId));
}
