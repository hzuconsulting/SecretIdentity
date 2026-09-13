import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Game, Round } from '@identite-secrete/shared';
import {
  RECENT_IDENTITIES_LIMIT,
  loadRecentIdentities,
  rememberIdentities,
  seedRecentIdentities,
} from './recentIdentities';

/**
 * La mémoire des personnages d'une partie à l'autre.
 *
 * Les tests tournent sous Node : on fournit un `window.localStorage` minimal,
 * le seul morceau de navigateur dont ce module a besoin.
 */

function installStorage(): Map<string, string> {
  const data = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
  return data;
}

function gameWithBoards(...boards: string[][]): Game {
  return {
    rounds: boards.map((board) => ({ board }) as unknown as Round),
    usedIdentityIds: new Set<string>(),
  } as unknown as Game;
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('mémoire des personnages récents', () => {
  it('retient les personnages de tous les plateaux joués', () => {
    rememberIdentities(gameWithBoards(['a', 'b'], ['c', 'd']));
    expect(loadRecentIdentities()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('déplace en fin de liste un personnage revu, sans doublon', () => {
    rememberIdentities(gameWithBoards(['a', 'b', 'c']));
    rememberIdentities(gameWithBoards(['b', 'e']));
    expect(loadRecentIdentities()).toEqual(['a', 'c', 'b', 'e']);
  });

  it('oublie les plus anciens au-delà de la limite', () => {
    const many = Array.from({ length: RECENT_IDENTITIES_LIMIT + 10 }, (_, i) => `p${i}`);
    rememberIdentities(gameWithBoards(many));

    const recent = loadRecentIdentities();
    expect(recent).toHaveLength(RECENT_IDENTITIES_LIMIT);
    expect(recent[0]).toBe('p10');
    expect(recent.at(-1)).toBe(`p${RECENT_IDENTITIES_LIMIT + 9}`);
  });

  it('verse la mémoire dans une partie neuve, jamais dans une partie commencée', () => {
    rememberIdentities(gameWithBoards(['a', 'b']));

    const fresh = gameWithBoards();
    seedRecentIdentities(fresh);
    expect([...fresh.usedIdentityIds]).toEqual(['a', 'b']);

    const started = gameWithBoards(['z']);
    seedRecentIdentities(started);
    expect(started.usedIdentityIds.size).toBe(0);
  });

  it('résiste à un stockage corrompu', () => {
    window.localStorage.setItem('identite-secrete:recent-identities', '{pas du json');
    expect(loadRecentIdentities()).toEqual([]);
  });
});
