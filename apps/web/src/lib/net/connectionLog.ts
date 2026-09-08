'use client';

/**
 * Journal des tentatives de connexion réelles.
 *
 * Il existe parce que l'auto-test de `/diagnostic` a une limite qu'on ne peut
 * pas lever : il se connecte à l'appareil lui-même, et certains navigateurs —
 * Safari au premier chef — refusent cette boucle tout en fonctionnant très bien
 * entre deux téléphones. Son verdict sur l'ouverture du canal n'est donc pas
 * concluant.
 *
 * Ce qui l'est, c'est une vraie partie. On garde donc la trace technique de
 * chaque tentative — état ICE, types de candidats, cause de l'échec — pour que
 * `/diagnostic` puisse la montrer après coup. C'est la différence entre « ça ne
 * marche pas » et une panne qu'on peut nommer.
 *
 * Le stockage est local et minuscule : rien ne part sur le réseau, et aucun
 * pseudo ni identité n'y figure.
 */

const KEY = 'identite-secrete:connexions';
const MAX_ENTRIES = 8;

export type AttemptRole = 'invité' | 'hôte';
export type AttemptOutcome = 'réussi' | 'échec';

export interface ConnectionAttempt {
  at: number;
  role: AttemptRole;
  code: string;
  outcome: AttemptOutcome;
  detail: string;
}

export function recordAttempt(entry: Omit<ConnectionAttempt, 'at'>): void {
  if (typeof window === 'undefined') return;

  try {
    const attempts = [{ ...entry, at: Date.now() }, ...readAttempts()].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(KEY, JSON.stringify(attempts));
  } catch {
    // Stockage plein ou refusé : le jeu n'en dépend pas, on perd seulement la
    // trace pour le diagnostic.
  }
}

export function readAttempts(): ConnectionAttempt[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isAttempt).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function clearAttempts(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Sans conséquence.
  }
}

function isAttempt(value: unknown): value is ConnectionAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;

  return (
    typeof entry.at === 'number' &&
    typeof entry.code === 'string' &&
    typeof entry.detail === 'string' &&
    (entry.outcome === 'réussi' || entry.outcome === 'échec') &&
    (entry.role === 'invité' || entry.role === 'hôte')
  );
}
