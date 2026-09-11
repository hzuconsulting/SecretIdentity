import {
  MAX_PICTOS,
  MIN_PICTOS,
  cardIcons,
  type GameErrorCode,
  type PictoCard,
  type PlacedPicto,
} from '@identite-secrete/shared';

/**
 * Validation d'un boîtier.
 *
 * Zod a déjà vérifié la **forme** du payload (1 à 3 entrées, chacune avec une
 * carte, une icône et une zone). Ici on vérifie le **fond**, c'est-à-dire tout
 * ce qui dépend de la main du joueur :
 *  - la carte lui appartient encore — celles des manches passées ont été
 *    défaussées définitivement ;
 *  - il ne joue pas deux fois la même carte ;
 *  - le pictogramme montré est bien l'un des quatre de cette carte — deux par
 *    face — parce qu'une carte n'en montre jamais qu'un.
 *
 * Fonction pure : c'est l'anti-triche du §6, et elle doit être testable sans
 * réseau ni partie en mémoire.
 */

export type PlacementValidation =
  | { ok: true; placed: PlacedPicto[] }
  | { ok: false; code: GameErrorCode; message?: string };

export function validatePlacement(
  placed: readonly PlacedPicto[],
  hand: readonly PictoCard[],
): PlacementValidation {
  if (placed.length < MIN_PICTOS) {
    return { ok: false, code: 'NOT_ENOUGH_CLUES' };
  }

  if (placed.length > MAX_PICTOS) {
    return {
      ok: false,
      code: 'TOO_MANY_CLUES',
      message: `${MAX_PICTOS} pictogrammes maximum.`,
    };
  }

  // Impossible de poser plus de cartes qu'il n'en reste : en fin de partie, une
  // main réduite limite mécaniquement ce qu'on peut dire.
  if (placed.length > hand.length) {
    return {
      ok: false,
      code: 'CARD_NOT_IN_HAND',
      message: `Il ne te reste que ${hand.length} carte${hand.length > 1 ? 's' : ''}.`,
    };
  }

  const cardsById = new Map(hand.map((card) => [card.id, card]));
  const used = new Set<string>();

  for (const picto of placed) {
    const card = cardsById.get(picto.cardId);
    if (!card) return { ok: false, code: 'CARD_NOT_IN_HAND' };

    if (used.has(picto.cardId)) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Une carte ne peut pas être posée deux fois.',
      };
    }
    used.add(picto.cardId);

    if (!cardIcons(card).includes(picto.iconId)) {
      return {
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Ce pictogramme n’est pas sur cette carte.',
      };
    }
  }

  return { ok: true, placed: placed.map((picto) => ({ ...picto })) };
}

/** Deux boîtiers identiques, quel que soit l'ordre des pictogrammes. */
export function samePlacement(a: readonly PlacedPicto[], b: readonly PlacedPicto[]): boolean {
  if (a.length !== b.length) return false;

  const key = (picto: PlacedPicto) => `${picto.cardId}|${picto.iconId}|${picto.zone}`;
  const set = new Set(a.map(key));
  return b.every((picto) => set.has(key(picto)));
}

/** Les cartes citées par un boîtier — celles qui partent à la défausse. */
export function playedCardIds(placed: readonly PlacedPicto[]): Set<string> {
  return new Set(placed.map((picto) => picto.cardId));
}
