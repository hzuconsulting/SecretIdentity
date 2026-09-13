import { describe, expect, it } from 'vitest';
import type { RelayHandoffPayload, RelaySnapshot } from '@identite-secrete/shared';
import { encodeMessage, parseHostMessage } from './protocol';
import { isStale, pickBestRelay, type StoredRelay } from './relayStorage';

/**
 * Le départage des instantanés de reprise.
 *
 * Un invité en reçoit plusieurs au cours d'une partie, et peut aussi en trouver
 * un vieux dans son stockage en revenant le lendemain. Choisir le mauvais, c'est
 * reprendre la partie à un état périmé — donc la faire remonter dans le temps
 * sous les yeux de tout le monde, avec des scores qui reculent.
 *
 * Les horloges n'entrent jamais dans le départage : celles des pairs divergent,
 * c'est tout l'objet de `measureClockOffset`. Seuls comptent la génération, puis
 * le compteur.
 */

function snapshot(epoch: number, seq: number): RelaySnapshot {
  return {
    v: 1,
    code: 'ABCDE',
    hostId: 'p1',
    phase: 'LOBBY',
    currentRound: 0,
    settings: { clueSeconds: 60, guessSeconds: 60, difficulty: 'medium', visibility: 'public' },
    players: [],
    rounds: [],
    usedIdentityIds: [],
    bannedNicknames: [],
    epoch,
    seq,
    issuedAt: 0,
  };
}

function stored(epoch: number, seq: number, receivedAt = 1_000): StoredRelay {
  const payload: RelayHandoffPayload = { snapshot: snapshot(epoch, seq), rank: 0, successors: 2 };
  return { payload, receivedAt };
}

describe('départage de deux instantanés', () => {
  it('prend le premier venu quand la réserve est vide', () => {
    const incoming = stored(0, 1);
    expect(pickBestRelay(null, incoming)).toBe(incoming);
  });

  it('préfère le compteur le plus élevé, à génération égale', () => {
    const ancien = stored(0, 4);
    const recent = stored(0, 7);

    expect(pickBestRelay(ancien, recent)).toBe(recent);
    expect(pickBestRelay(recent, ancien)).toBe(recent);
  });

  it('fait primer la génération sur le compteur', () => {
    // Le cas qui compte vraiment. Après une reprise, le nouvel hôte repart d'un
    // compteur à zéro : comparer les compteurs seuls ferait préférer l'ancien
    // état, pourtant abandonné — et la partie reculerait d'une manche.
    const avantReprise = stored(0, 99);
    const apresReprise = stored(1, 1);

    expect(pickBestRelay(avantReprise, apresReprise)).toBe(apresReprise);
    expect(pickBestRelay(apresReprise, avantReprise)).toBe(apresReprise);
  });

  it('ne se laisse pas décider par les horloges', () => {
    // Un pair dont l'horloge avance de dix minutes ne doit pas pouvoir imposer
    // son état à toute la table.
    const bonMaisAncienSelonLHorloge = stored(1, 5, 0);
    const mauvaisMaisRecentSelonLHorloge = stored(0, 5, 9_999_999);

    expect(pickBestRelay(mauvaisMaisRecentSelonLHorloge, bonMaisAncienSelonLHorloge)).toBe(
      bonMaisAncienSelonLHorloge,
    );
  });
});

describe('péremption', () => {
  it('écarte un instantané plus vieux que dix minutes', () => {
    const entry = stored(0, 1, 0);

    expect(isStale(entry, 9 * 60 * 1_000)).toBe(false);
    expect(isStale(entry, 11 * 60 * 1_000)).toBe(true);
  });

  it('garde un instantané tout juste reçu', () => {
    expect(isStale(stored(0, 1, 5_000), 5_100)).toBe(false);
  });
});

describe('passage sur le fil', () => {
  it('survit à l’encodage du canal', () => {
    // L'instantané est ce qui pèse le plus lourd sur ce canal : il doit passer
    // par le même chemin que le reste, sans découpage ni traitement à part.
    const payload: RelayHandoffPayload = {
      snapshot: snapshot(2, 17),
      rank: 1,
      successors: 3,
    };

    const encoded = encodeMessage({ t: 'evt', event: 'host:relay', payload });
    const decoded = parseHostMessage(encoded);

    expect(decoded?.t).toBe('evt');
    if (decoded?.t === 'evt') expect(decoded.payload).toEqual(payload);
  });
});
