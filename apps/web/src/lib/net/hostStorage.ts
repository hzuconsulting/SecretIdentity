'use client';

import { deserializeGame, serializeGame } from '@identite-secrete/engine';
import type { Game } from '@identite-secrete/shared';

/**
 * Sauvegarde de la partie hébergée, dans le `localStorage` de l'hôte.
 *
 * Sans elle, le moteur ne survivrait pas à un rafraîchissement de page — et sur
 * un téléphone, l'onglet peut être rechargé par le système sans que personne
 * n'ait rien demandé. Une partie de huit manches disparaîtrait alors au milieu.
 *
 * Ce qui est écrit contient les identités secrètes de tous les joueurs. C'est
 * acceptable parce que le stockage est celui de l'hôte, sur son appareil, et
 * qu'il détient déjà cet état en mémoire : on ne divulgue rien de nouveau. Rien
 * de tout cela ne part sur le réseau.
 */

const PREFIX = 'identite-secrete:hosted:';

/** Au-delà, la sauvegarde est considérée comme périmée et ignorée. */
const MAX_AGE_MS = 6 * 60 * 60 * 1_000;

function key(code: string): string {
  return `${PREFIX}${code.toUpperCase()}`;
}

export function saveHostedGame(game: Game): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key(game.code), JSON.stringify(serializeGame(game)));
  } catch {
    // Stockage plein ou refusé (navigation privée verrouillée). La partie
    // continue normalement : on perd seulement la survie au rafraîchissement.
  }
}

export function loadHostedGame(code: string): Game | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key(code));
    if (!raw) return null;

    const game = deserializeGame(JSON.parse(raw));
    if (!game) {
      clearHostedGame(code);
      return null;
    }

    if (Date.now() - game.lastActivityAt > MAX_AGE_MS) {
      clearHostedGame(code);
      return null;
    }

    return game;
  } catch {
    clearHostedGame(code);
    return null;
  }
}

export function clearHostedGame(code: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key(code));
  } catch {
    // Rien à faire : au pire l'entrée périmera d'elle-même.
  }
}

/** `true` si cet appareil détient l'état d'une partie sous ce code. */
export function hasHostedGame(code: string): boolean {
  return loadHostedGame(code) !== null;
}
