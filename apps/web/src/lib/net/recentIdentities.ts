'use client';

import type { Game, IdentityId } from '@identite-secrete/shared';

/**
 * Les personnages déjà montrés sur cet appareil, d'une partie à l'autre.
 *
 * Dans une partie, le moteur ne redonne jamais un personnage déjà sorti
 * (`usedIdentityIds`). Mais une partie neuve repartait d'une ardoise vierge : à
 * la troisième ou quatrième soirée, la même table revoyait les mêmes têtes. On
 * garde donc, chez l'hôte, la mémoire des derniers personnages vus, et on la
 * verse dans chaque nouvelle partie.
 *
 * Le moteur sait déjà quoi faire si cette mémoire épuise le catalogue : il
 * repart du catalogue complet (§9). On borne quand même la liste, pour qu'elle
 * écarte les personnages **récents** sans jamais vider une difficulté entière.
 *
 * Rien de secret ici : ce sont des personnages qui ont été affichés sur le
 * plateau, donc vus par toute la table.
 */

const KEY = 'identite-secrete:recent-identities';

/**
 * Taille de la mémoire : huit parties de quatre manches à huit personnages.
 * Bien en dessous de ce que compte chaque difficulté du catalogue, pour qu'il
 * reste toujours de quoi tirer un plateau neuf.
 */
export const RECENT_IDENTITIES_LIMIT = 256;

export function loadRecentIdentities(): IdentityId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === 'string').slice(-RECENT_IDENTITIES_LIMIT)
      : [];
  } catch {
    return [];
  }
}

/**
 * Ajoute les personnages d'une partie à la mémoire, les plus récents en fin de
 * liste. Un personnage revu est déplacé à la fin : c'est sa dernière apparition
 * qui compte.
 */
export function rememberIdentities(game: Game): void {
  if (typeof window === 'undefined') return;

  const seen = new Set<IdentityId>();
  for (const round of game.rounds) for (const id of round.board) seen.add(id);
  if (seen.size === 0) return;

  const merged = [...loadRecentIdentities().filter((id) => !seen.has(id)), ...seen];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged.slice(-RECENT_IDENTITIES_LIMIT)));
  } catch {
    // Stockage plein ou refusé (navigation privée) : on perd la mémoire, pas la
    // partie. Le tirage reste bon, seulement moins varié d'une soirée à l'autre.
  }
}

/**
 * Verse la mémoire dans une partie qui n'a encore joué aucune manche.
 * Au-delà, `usedIdentityIds` suit sa vie normale dans le moteur.
 */
export function seedRecentIdentities(game: Game): void {
  if (game.rounds.length > 0) return;
  for (const id of loadRecentIdentities()) game.usedIdentityIds.add(id);
}
