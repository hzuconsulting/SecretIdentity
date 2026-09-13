import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS, TOTAL_ROUNDS, type Game, type Player } from '@identite-secrete/shared';
import {
  ANNOUNCE_DEBOUNCE_MS,
  DirectoryAnnouncer,
  DirectoryUnavailableError,
  HEARTBEAT_MS,
  MAX_LISTED,
  MIN_PUBLISH_INTERVAL_MS,
  RATE_LIMIT_PAUSE_MS,
  STALE_MS,
  aggregateDirectory,
  describeGame,
  encodeDirectoryMessage,
  estimateServerNow,
  fetchDirectoryRecords,
  parseDirectoryMessage,
  parseDirectoryPoll,
  type DirectoryListing,
  type DirectoryMessage,
  type DirectoryRecord,
  type Publish,
  type PublishOutcome,
} from './directory';

/**
 * L'annuaire des parties publiques.
 *
 * Le sujet ntfy est public : n'importe qui peut y écrire. Ces tests fixent ce
 * qui en est accepté, comment le dernier mot d'un hôte l'emporte, et le débit
 * que l'annonceur s'interdit de dépasser — c'est lui qui consomme le quota
 * quotidien du réseau de l'hôte.
 */

function listing(overrides: Partial<DirectoryListing> = {}): DirectoryListing {
  return {
    code: 'K7P4Q',
    host: 'Zoé',
    players: 3,
    max: MAX_PLAYERS,
    status: 'lobby',
    round: 0,
    rounds: TOTAL_ROUNDS,
    gen: 0,
    ...overrides,
  };
}

function open(overrides: Partial<DirectoryListing> = {}): DirectoryMessage {
  return { type: 'open', at: 0, ...listing(overrides) };
}

function closed(code = 'K7P4Q', gen = 0): DirectoryMessage {
  return { type: 'closed', code, gen, at: 0 };
}

function record(time: number, message: DirectoryMessage): DirectoryRecord {
  return { time, message };
}

/** Une ligne telle que la renvoie `GET /<sujet>/json?poll=1`. */
function ntfyLine(body: string, timeSeconds = 1_789_291_856, event = 'message'): string {
  return JSON.stringify({
    id: 'nZIcwIupfF9q',
    time: timeSeconds,
    expires: timeSeconds + 43_200,
    event,
    topic: 'identite-secrete-v1-parties-test',
    message: body,
  });
}

describe('format des annonces', () => {
  it('fait l’aller-retour d’une annonce et d’un retrait', () => {
    const announce = open({ players: 5, status: 'playing', round: 2 });
    expect(parseDirectoryMessage(encodeDirectoryMessage(announce))).toEqual(announce);
    expect(parseDirectoryMessage(encodeDirectoryMessage(closed()))).toEqual(closed());
  });

  it('normalise le code, comme la saisie à la main', () => {
    const raw = JSON.stringify({ v: 1, ...open(), code: 'k7p-4q' });
    expect(parseDirectoryMessage(raw)?.code).toBe('K7P4Q');
  });

  it.each([
    ['un code trop court', { code: 'K7P4' }],
    ['un code hors alphabet (O et 0 exclus)', { code: 'K7PO0' }],
    ['un pseudo trop long', { host: 'x'.repeat(40) }],
    ['un pseudo vide', { host: '   ' }],
    ['plus de joueurs que de places', { players: 8, max: 5 }],
    ['plus de joueurs que le maximum du jeu', { players: MAX_PLAYERS + 1, max: MAX_PLAYERS + 1 }],
    ['une manche au-delà de la dernière', { round: TOTAL_ROUNDS + 1 }],
    ['un nombre de joueurs non entier', { players: 2.5 }],
    ['un statut inconnu', { status: 'finished' }],
    ['une autre version du format', { v: 2 }],
    ['un type inconnu', { type: 'spam' }],
  ])('refuse %s', (_label, patch) => {
    const raw = JSON.stringify({ v: 1, ...open(), ...patch });
    expect(parseDirectoryMessage(raw)).toBeNull();
  });

  it('refuse ce qui n’est pas du JSON, ou pas un objet', () => {
    expect(parseDirectoryMessage('coucou')).toBeNull();
    expect(parseDirectoryMessage('null')).toBeNull();
    expect(parseDirectoryMessage('[1,2,3]')).toBeNull();
  });

  it('retire du pseudo les caractères de contrôle et de forçage de sens', () => {
    const raw = JSON.stringify({ v: 1, ...open(), host: '\u202EZoé\u0007' });
    expect(parseDirectoryMessage(raw)).toMatchObject({ host: 'Zoé' });
  });

  it('ne garde pas les champs inconnus', () => {
    const raw = JSON.stringify({ v: 1, ...open(), sessionToken: 'secret', html: '<b>x</b>' });
    const parsed = parseDirectoryMessage(raw);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty('sessionToken');
    expect(parsed).not.toHaveProperty('html');
  });
});

describe('lecture d’une réponse ntfy', () => {
  it('garde les annonces valides, horodatées par le service, dans l’ordre', () => {
    const body = [
      ntfyLine(encodeDirectoryMessage(open()), 100),
      ntfyLine(encodeDirectoryMessage(closed()), 101),
      '',
    ].join('\n');

    expect(parseDirectoryPoll(body)).toEqual([
      { time: 100_000, message: open() },
      { time: 101_000, message: closed() },
    ]);
  });

  it('ignore les lignes illisibles, les autres événements et les messages étrangers', () => {
    const body = [
      '{"tronqué":',
      ntfyLine('', 100, 'keepalive'),
      ntfyLine('Coucou tout le monde', 100),
      ntfyLine(JSON.stringify({ v: 1, type: 'open', code: 'ZZZZZ' }), 100),
      JSON.stringify({ time: 'hier', event: 'message', message: encodeDirectoryMessage(open()) }),
      ntfyLine(encodeDirectoryMessage(open({ code: 'ABCDE' })), 102),
    ].join('\n');

    const records = parseDirectoryPoll(body);
    expect(records).toHaveLength(1);
    expect(records[0]?.message.code).toBe('ABCDE');
  });

  it('ne lit que la fin d’une réponse inondée', () => {
    const lines = [
      ntfyLine(encodeDirectoryMessage(open({ code: 'AAAAA' })), 50),
      ...Array.from({ length: 5_000 }, () => ntfyLine('bruit', 100)),
      ntfyLine(encodeDirectoryMessage(open({ code: 'BBBBB' })), 200),
    ];
    const records = parseDirectoryPoll(lines.join('\n'));
    expect(records.map((entry) => entry.message.code)).toEqual(['BBBBB']);
  });
});

describe('agrégation', () => {
  const NOW = 1_000_000;

  it('ne garde que le dernier mot de chaque partie', () => {
    const games = aggregateDirectory(
      [
        record(NOW - 30_000, open({ players: 2 })),
        record(NOW - 10_000, open({ players: 4 })),
      ],
      NOW,
    );

    expect(games).toEqual([{ ...listing({ players: 4 }), updatedAt: NOW - 10_000 }]);
  });

  it('fait disparaître une partie retirée', () => {
    const games = aggregateDirectory(
      [record(NOW - 30_000, open()), record(NOW - 10_000, closed())],
      NOW,
    );
    expect(games).toEqual([]);
  });

  it('fait réapparaître une partie réannoncée après un retrait', () => {
    const games = aggregateDirectory(
      [
        record(NOW - 30_000, open()),
        record(NOW - 20_000, closed()),
        record(NOW - 10_000, open()),
      ],
      NOW,
    );
    expect(games.map((game) => game.code)).toEqual(['K7P4Q']);
  });

  it('départage deux messages de la même seconde par l’ordre d’arrivée', () => {
    expect(aggregateDirectory([record(NOW, open()), record(NOW, closed())], NOW)).toEqual([]);
    expect(aggregateDirectory([record(NOW, closed()), record(NOW, open())], NOW)).toHaveLength(1);
  });

  it('écarte une annonce dont l’hôte ne donne plus signe de vie', () => {
    const games = aggregateDirectory(
      [
        record(NOW - STALE_MS - 1, open({ code: 'AAAAA' })),
        record(NOW - STALE_MS, open({ code: 'BBBBB' })),
      ],
      NOW,
    );
    expect(games.map((game) => game.code)).toEqual(['BBBBB']);
  });

  it('donne raison à la génération la plus haute, même plus ancienne', () => {
    // L'ancien hôte, revenu après une reprise, retire « sa » partie : ça ne
    // doit pas effacer l'annonce du joueur qui l'héberge désormais.
    const games = aggregateDirectory(
      [
        record(NOW - 20_000, open({ gen: 1, host: 'Léo' })),
        record(NOW - 5_000, closed('K7P4Q', 0)),
        record(NOW - 4_000, open({ gen: 0, host: 'Zoé' })),
      ],
      NOW,
    );
    expect(games).toEqual([{ ...listing({ gen: 1, host: 'Léo' }), updatedAt: NOW - 20_000 }]);
  });

  it('plafonne la liste en gardant les annonces les plus récentes', () => {
    const codes = Array.from({ length: MAX_LISTED + 5 }, (_, index) =>
      `AB${String.fromCharCode(65 + Math.floor(index / 8))}${String.fromCharCode(65 + (index % 8))}C`,
    );
    const records = codes.map((code, index) => record(NOW - 60_000 + index * 1_000, open({ code })));

    const games = aggregateDirectory(records, NOW);
    expect(games).toHaveLength(MAX_LISTED);
    // Les cinq plus anciennes sont celles qui tombent.
    for (const code of codes.slice(0, 5)) expect(games.map((game) => game.code)).not.toContain(code);
  });

  it('montre d’abord ce qu’on peut rejoindre, dans un ordre stable', () => {
    const games = aggregateDirectory(
      [
        record(NOW - 1_000, open({ code: 'PPPPP', host: 'Paul', status: 'playing', round: 2 })),
        record(NOW - 2_000, open({ code: 'FFFFF', host: 'Fanny', players: MAX_PLAYERS })),
        record(NOW - 3_000, open({ code: 'ZZZZZ', host: 'Zoé' })),
        record(NOW - 4_000, open({ code: 'AAAAA', host: 'alice' })),
      ],
      NOW,
    );

    expect(games.map((game) => game.host)).toEqual(['alice', 'Zoé', 'Fanny', 'Paul']);
  });
});

describe('heure de référence', () => {
  it('prend l’horloge locale quand elle est cohérente avec le service', () => {
    expect(estimateServerNow([record(100_000, open())], 110_000)).toBe(110_000);
  });

  it('borne une horloge locale qui avance', () => {
    const records = [record(100_000, open())];
    const now = estimateServerNow(records, 100_000 + 10 * 60_000);
    expect(now).toBe(100_000 + HEARTBEAT_MS);
    expect(aggregateDirectory(records, now)).toHaveLength(1);
  });

  it('se rabat sur l’horloge locale sans aucune annonce', () => {
    expect(estimateServerNow([], 42)).toBe(42);
  });
});

describe('ce qu’une partie publie d’elle-même', () => {
  function player(id: string, nickname: string, connected = true): Player {
    return {
      id,
      sessionToken: `jeton-secret-${id}`,
      connectionId: connected ? `c-${id}` : null,
      nickname,
      score: 3,
      hand: [],
      connected,
      disconnectedAt: connected ? null : 1,
      joinedAt: 0,
    };
  }

  function game(overrides: Partial<Game> = {}): Game {
    const players = new Map<string, Player>([
      ['p1', player('p1', 'Zoé')],
      ['p2', player('p2', 'Léo')],
      ['p3', player('p3', 'Max', false)],
    ]);

    return {
      code: 'K7P4Q',
      hostId: 'p1',
      phase: 'LOBBY',
      currentRound: 0,
      settings: { clueSeconds: 60, guessSeconds: 60, difficulty: 'medium', visibility: 'public' },
      players,
      rounds: [],
      usedIdentityIds: new Set(),
      bannedNicknames: new Set(),
      createdAt: 0,
      lastActivityAt: 0,
      epoch: 0,
      pausedAt: null,
      ...overrides,
    } as Game;
  }

  it('annonce un salon public avec ses joueurs connectés', () => {
    expect(describeGame(game())).toEqual(listing({ players: 2 }));
  });

  it('annonce la manche d’une partie en cours, et sa génération', () => {
    expect(describeGame(game({ phase: 'GUESSING', currentRound: 3, epoch: 2 }))).toEqual(
      listing({ players: 2, status: 'playing', round: 3, gen: 2 }),
    );
  });

  it('ne publie rien d’une partie privée', () => {
    const settings = { ...game().settings, visibility: 'private' as const };
    expect(describeGame(game({ settings }))).toBeNull();
  });

  it('ne publie plus rien d’une partie terminée', () => {
    expect(describeGame(game({ phase: 'FINAL_RESULTS', currentRound: TOTAL_ROUNDS }))).toBeNull();
  });

  it('ne laisse sortir aucun secret', () => {
    const published = encodeDirectoryMessage({ type: 'open', at: 0, ...describeGame(game())! });
    expect(published).not.toContain('jeton-secret');
    expect(Object.keys(JSON.parse(published)).sort()).toEqual(
      ['at', 'code', 'gen', 'host', 'max', 'players', 'round', 'rounds', 'status', 'type', 'v'].sort(),
    );
  });

  it('produit une annonce que les lecteurs acceptent', () => {
    const published = encodeDirectoryMessage({ type: 'open', at: 0, ...describeGame(game())! });
    expect(parseDirectoryMessage(published)).not.toBeNull();
  });
});

describe('l’annonceur', () => {
  let sent: Array<{ at: number; message: DirectoryMessage; final: boolean }>;
  let outcome: PublishOutcome;
  let announcer: DirectoryAnnouncer;

  const publish: Publish = (body, { final }) => {
    const message = parseDirectoryMessage(body);
    if (!message) throw new Error(`message illisible : ${body}`);
    sent.push({ at: Date.now(), message, final });
    return Promise.resolve(outcome);
  };

  const types = () => sent.map((entry) => entry.message.type);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    sent = [];
    outcome = 'ok';
    announcer = new DirectoryAnnouncer(publish);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    announcer.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('publie un changement après un court délai', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 1);
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toMatchObject({ type: 'open', code: 'K7P4Q', players: 3 });
  });

  it('fait d’une rafale de changements une seule annonce, sans la repousser', () => {
    for (let players = 1; players <= 5; players++) {
      announcer.update(listing({ players }));
      vi.advanceTimersByTime(500);
    }
    // Cinq changements en 2,5 s : le premier fixe l'échéance.
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS - 2_500);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toMatchObject({ players: 5 });
  });

  it('ne publie jamais deux fois en moins de dix secondes', () => {
    // Un joueur dont la connexion clignote, pendant deux minutes.
    for (let step = 0; step < 240; step++) {
      announcer.update(listing({ players: step % 2 === 0 ? 3 : 4 }));
      vi.advanceTimersByTime(500);
    }

    for (let index = 1; index < sent.length; index++) {
      expect(sent[index]!.at - sent[index - 1]!.at).toBeGreaterThanOrEqual(MIN_PUBLISH_INTERVAL_MS);
    }
    expect(sent.length).toBeLessThanOrEqual(120_000 / MIN_PUBLISH_INTERVAL_MS + 1);
  });

  it('ignore une mise à jour qui ne change rien', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    announcer.update(listing());
    announcer.update(listing());
    vi.advanceTimersByTime(HEARTBEAT_MS - 1);
    expect(sent).toHaveLength(1);
  });

  it('renouvelle une annonce inchangée au rythme du battement', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);

    expect(types()).toEqual(['open', 'open', 'open', 'open']);
    expect(sent[1]!.at - sent[0]!.at).toBe(HEARTBEAT_MS);
    // Le battement tient la partie en vie aux yeux des lecteurs.
    expect(HEARTBEAT_MS * 2).toBeLessThan(STALE_MS);
  });

  it('retire l’annonce quand la partie devient privée, sans attendre le délai', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    vi.advanceTimersByTime(20_000);

    announcer.update(null);
    vi.advanceTimersByTime(0);
    expect(types()).toEqual(['open', 'closed']);
    expect(sent[1]?.message).toMatchObject({ code: 'K7P4Q', gen: 0 });

    // Plus rien ensuite : pas de battement pour une partie retirée.
    vi.advanceTimersByTime(HEARTBEAT_MS * 4);
    expect(sent).toHaveLength(2);
  });

  it('respecte le plancher même pour un retrait', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    announcer.update(null);
    vi.advanceTimersByTime(MIN_PUBLISH_INTERVAL_MS - 1);
    expect(types()).toEqual(['open']);
    vi.advanceTimersByTime(1);
    expect(types()).toEqual(['open', 'closed']);
  });

  it('ne publie rien pour une partie qui n’a jamais été annoncée', () => {
    announcer.update(null);
    announcer.update(listing());
    announcer.update(null);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    announcer.stop();
    expect(sent).toHaveLength(0);
  });

  it('retire l’annonce à l’arrêt, par un envoi qui survit à la page', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    announcer.stop();

    expect(types()).toEqual(['open', 'closed']);
    expect(sent[1]?.final).toBe(true);

    // Une sauvegarde en retard après l'arrêt ne relance rien.
    announcer.update(listing());
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('retire l’annonce à la fermeture de page, et la rétablit si la page survit', () => {
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);

    announcer.withdrawNow();
    expect(types()).toEqual(['open', 'closed']);
    expect(sent[1]?.final).toBe(true);

    vi.advanceTimersByTime(MIN_PUBLISH_INTERVAL_MS);
    expect(types()).toEqual(['open', 'closed', 'open']);
  });

  it('se met en pause après un refus pour excès de débit', async () => {
    outcome = 'rate-limited';
    announcer.update(listing());
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
    await Promise.resolve();
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(RATE_LIMIT_PAUSE_MS - 1_000);
    expect(sent).toHaveLength(1);

    outcome = 'ok';
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(2);
  });

  it('survit à un service injoignable', async () => {
    const failing = new DirectoryAnnouncer(() => Promise.reject(new Error('hors ligne')));
    const throwing = new DirectoryAnnouncer(() => {
      throw new Error('synchrone');
    });

    for (const subject of [failing, throwing]) {
      subject.update(listing());
      expect(() => vi.advanceTimersByTime(HEARTBEAT_MS * 2)).not.toThrow();
      expect(() => subject.stop()).not.toThrow();
    }
    await Promise.resolve();
  });
});

describe('relecture', () => {
  it('interroge la fenêtre de péremption, décomptée par le service', async () => {
    const fetchImpl = vi.fn(async () => new Response(ntfyLine(encodeDirectoryMessage(open()), 100)));

    const records = await fetchDirectoryRecords('https://ntfy.example/sujet', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(records).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://ntfy.example/sujet/json?poll=1&since=${STALE_MS / 1_000}s`,
      expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
    );
  });

  it('signale un service indisponible par une erreur dédiée', async () => {
    const rateLimited = vi.fn(async () => new Response('', { status: 429 }));
    await expect(
      fetchDirectoryRecords('https://ntfy.example/sujet', {
        fetchImpl: rateLimited as unknown as typeof fetch,
      }),
    ).rejects.toEqual(new DirectoryUnavailableError(429));

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      fetchDirectoryRecords('https://ntfy.example/sujet', {
        fetchImpl: offline as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(DirectoryUnavailableError);
  });
});
