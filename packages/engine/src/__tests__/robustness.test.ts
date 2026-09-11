import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  GAME_TTL_MS,
  MIN_PLAYERS,
  type SessionPayload,
} from '@identite-secrete/shared';
import { RateLimiter } from '../rateLimit';
import {
  TEST_GRACE_MS,
  TestClient,
  startTestServer,
  wait,
  waitForRoundEnd,
  type TestHost,
} from './helpers';

/**
 * Cas limites du §9 et robustesse générale (Lot 5).
 */

/** Le boîtier des `count` premières cartes de la main, en zone verte. */
function placedOf(client: TestClient, count = 2) {
  return client.lastView.yourHand!.slice(0, count).map((card) => ({
    cardId: card.id,
    iconId: card.front[0],
    zone: 'green' as const,
  }));
}

let server: TestHost;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = TestClient.connect(server);
  clients.push(client);
  return client;
}

async function startedGame(playerCount = 3): Promise<{ code: string; players: TestClient[] }> {
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const players = [host];

  const names = ['Allan', 'Malo', 'Zoé'];
  for (let i = 1; i < playerCount; i++) {
    const guest = await connect();
    await guest.joinGame(code, names[i - 1]!);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === playerCount, 'salon complet');
  const settings = await host.emit(CLIENT_EVENTS.updateSettings, {
    clueSeconds: 90,
    guessSeconds: 90,
  });
  expect(settings.ok).toBe(true);

  await host.emit(CLIENT_EVENTS.startGame, {});
  for (const client of players) {
    await client.waitForView((v) => v.phase === 'CLUE_SELECTION', 'sélection', 8_000);
  }

  return { code, players };
}

beforeEach(async () => {
  server = startTestServer();
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  server.close();
});

// ─────────────────────────────────────────────────────────────

describe('mise en pause sous 3 joueurs', () => {
  it('gèle la partie quand il ne reste pas assez de joueurs connectés', async () => {
    const { players } = await startedGame();
    const [host, , malo] = players as [TestClient, TestClient, TestClient];

    malo.disconnect();

    const view = await host.waitForView((v) => v.paused === true, 'partie en pause');
    expect(view.pauseReason).toContain(String(MIN_PLAYERS));
    expect(view.phase).toBe('CLUE_SELECTION');
  });

  it('refuse les actions de jeu pendant la pause', async () => {
    const { players } = await startedGame();
    const [host, , malo] = players as [TestClient, TestClient, TestClient];

    malo.disconnect();
    await host.waitForView((v) => v.paused === true, 'pause');

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: placedOf(host),
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('GAME_PAUSED');
  });

  it('n’avance plus dans les phases tant qu’elle est en pause', async () => {
    const { players } = await startedGame();
    const [host, , malo] = players as [TestClient, TestClient, TestClient];

    malo.disconnect();
    await host.waitForView((v) => v.paused === true, 'pause');

    const frozenPhase = host.lastView.phase;
    // Bien plus long que la phase de 900 ms : sans le gel, elle serait passée.
    await wait(2_000);

    expect(host.lastView.phase).toBe(frozenPhase);
    expect(host.lastView.paused).toBe(true);
  });

  it('reprend avec une échéance neuve quand quelqu’un revient', async () => {
    const { players } = await startedGame();
    const [host, , malo] = players as [TestClient, TestClient, TestClient];
    const session = malo.session!;

    malo.disconnect();
    await host.waitForView((v) => v.paused === true, 'pause');

    const revenant = await connect();
    const resuming = host.waitForNextView((v) => v.paused !== true, 'reprise');

    const response = await revenant.emit<SessionPayload>(CLIENT_EVENTS.rejoinGame, {
      sessionToken: session.sessionToken,
    });
    expect(response.ok).toBe(true);

    const resumed = await resuming;
    expect(resumed.phase).toBe('CLUE_SELECTION');
    // Le décompte repart : personne n'arrive sur une phase déjà expirée.
    expect(resumed.phaseEndsAt).toBeGreaterThan(resumed.serverTime);
  });

  it('conserve les soumissions déjà faites après une reprise', async () => {
    const { code, players } = await startedGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];
    const chosen = placedOf(host);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    malo.disconnect();
    await host.waitForView((v) => v.paused === true, 'pause');

    const revenant = await connect();
    const resuming = allan.waitForNextView((v) => v.paused !== true, 'reprise');
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: malo.session!.sessionToken });
    await resuming;

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.placed).toEqual(chosen);
    expect(assignment.cluesSubmitted).toBe(true);
  });

  it('ne compte pas les points deux fois après une reprise', async () => {
    const { code, players } = await startedGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitClues, { placed: placedOf(client) });
    }
    for (const client of players) {
      await client.waitForView((v) => v.phase === 'GUESSING', 'devinette', 4_000);
    }

    // Réponses parfaites pour Sarah, puis pause et reprise en pleine phase.
    const game = await server.store.get(code);
    const round = game!.rounds[0]!;
    const votes: Record<string, number> = {};
    for (const opponent of host.lastView.opponents ?? []) {
      votes[opponent.playerId] = round.assignments.get(opponent.playerId)!.slot;
    }
    await host.emit(CLIENT_EVENTS.submitGuesses, { votes });

    malo.disconnect();
    await host.waitForView((v) => v.paused === true, 'pause');

    const revenant = await connect();
    const resuming = allan.waitForNextView((v) => v.paused !== true, 'reprise');
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: malo.session!.sessionToken });
    await resuming;

    const results = await host.waitForView((v) => v.phase === 'RESULTS', 'révélation', 8_000);
    const sarah = results.roundScores?.find((line) => line.nickname === 'Sarah');

    // Sarah a trouvé les deux autres : +2, pas +4.
    expect(sarah?.guessed).toBe(2);
    expect(sarah?.cumulative).toBe(sarah?.total);
  });
});

// ─────────────────────────────────────────────────────────────

describe('joueur qui quitte en cours de manche', () => {
  it('termine la manche et révèle quand même sa série', async () => {
    const { players } = await startedGame(4);
    const [host, allan, malo, zoe] = players as [
      TestClient,
      TestClient,
      TestClient,
      TestClient,
    ];

    for (const client of [host, allan, malo, zoe]) {
      await client.emit(CLIENT_EVENTS.submitClues, { placed: placedOf(client) });
    }
    for (const client of [host, allan]) {
      await client.waitForView((v) => v.phase === 'GUESSING', 'devinette', 4_000);
    }

    // Zoé quitte volontairement : il reste 3 joueurs, donc pas de pause.
    await zoe.emit(CLIENT_EVENTS.leave, {});

    const results = await host.waitForView((v) => v.phase === 'RESULTS', 'révélation', 8_000);

    expect(results.reveals).toHaveLength(4);
    expect(results.reveals?.some((reveal) => reveal.nickname === 'Joueur parti')).toBe(true);
  });

  it('l’exclut des attributions de la manche suivante', async () => {
    const { code, players } = await startedGame(4);
    const [host, , , zoe] = players as [TestClient, TestClient, TestClient, TestClient];

    await zoe.emit(CLIENT_EVENTS.leave, {});
    await host.waitForView((v) => v.players.length === 3, 'Zoé partie');
    await waitForRoundEnd(host, 1);
    await host.emit(CLIENT_EVENTS.nextRound, {});
    await host.waitForView((v) => v.roundNumber === 2, 'manche 2');

    const game = await server.store.get(code);
    expect(game!.rounds[1]!.assignments.size).toBe(3);
    expect(game!.rounds[1]!.assignments.has(zoe.session!.playerId)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────

describe('limitation de débit', () => {
  it('compte sur une fenêtre glissante', () => {
    const limiter = new RateLimiter(3, 1_000);

    expect(limiter.accept(0)).toBe(true);
    expect(limiter.accept(100)).toBe(true);
    expect(limiter.accept(200)).toBe(true);
    expect(limiter.accept(300)).toBe(false);

    // La fenêtre a glissé : les trois premiers appels sont sortis du compte.
    expect(limiter.accept(1_500)).toBe(true);
  });

  it('refuse les rafales sans casser la connexion', async () => {
    const fast = startTestServer({
      rateLimitMaxEvents: 5,
      rateLimitWindowMs: 60_000,
    });
    const client = TestClient.connect(fast);

    try {
      const codes: string[] = [];
      for (let i = 0; i < 8; i++) {
        const response = await client.emit(CLIENT_EVENTS.joinGame, {
          code: 'ZZZZZ',
          nickname: 'Sarah',
        });
        if (!response.ok) codes.push(response.error.code);
      }

      expect(codes.filter((code) => code === 'GAME_NOT_FOUND')).toHaveLength(5);
      expect(codes.filter((code) => code === 'RATE_LIMITED')).toHaveLength(3);
      // Le canal est toujours vivant.
      expect(client.connected).toBe(true);
    } finally {
      client.close();
      fast.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('purge des parties inactives', () => {
  it('supprime une partie dont la dernière activité dépasse le TTL', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const game = await server.store.get(code);
    game!.lastActivityAt = Date.now() - GAME_TTL_MS - 1_000;

    const purged = await server.store.purgeInactive(GAME_TTL_MS, Date.now());

    expect(purged).toContain(code);
    expect(await server.store.get(code)).toBeUndefined();
  });

  it('épargne une partie encore active', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const purged = await server.store.purgeInactive(GAME_TTL_MS, Date.now());

    expect(purged).toHaveLength(0);
    expect(await server.store.get(code)).toBeDefined();
  });

  it('oublie le jeton de session d’une partie purgée', async () => {
    const host = await connect();
    const session = await host.createGame('Sarah');

    const game = await server.store.get(session.code);
    game!.lastActivityAt = 0;
    await server.store.purgeInactive(GAME_TTL_MS, Date.now());

    expect(await server.store.findBySessionToken(session.sessionToken)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────

describe('robustesse générale', () => {
  it('supprime la partie quand tout le monde s’est déconnecté définitivement', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');
    await host.waitForView((v) => v.players.length === 2, 'salon à 2');

    host.disconnect();
    guest.disconnect();
    await wait(TEST_GRACE_MS * 6);

    expect(await server.store.get(code)).toBeUndefined();
  });

  it('ne laisse aucune échéance orpheline derrière une partie supprimée', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    await host.emit(CLIENT_EVENTS.leave, {});

    expect(await server.store.get(code)).toBeUndefined();
    expect(server.timers.has(`${code}:phase`)).toBe(false);
    expect(server.timers.has(`${code}:host`)).toBe(false);
  });

  it('survit à une rafale de payloads malformés', async () => {
    const host = await connect();
    await host.createGame('Sarah');

    for (const payload of [null, 'texte', 42, [], { guesses: 'non' }]) {
      const response = await host.emit(CLIENT_EVENTS.updateSettings, payload);
      expect(response.ok).toBe(false);
    }

    const valid = await host.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 45 });
    expect(valid.ok).toBe(true);
  });

  it('rejette toute action de jeu sans session, sans exception', async () => {
    const client = await connect();

    for (const event of [
      CLIENT_EVENTS.startGame,
      CLIENT_EVENTS.submitClues,
      CLIENT_EVENTS.submitGuesses,
      CLIENT_EVENTS.nextRound,
      CLIENT_EVENTS.replay,
    ]) {
      const response = await client.emit(event, { placed: [], votes: {} });
      expect(response.ok, event).toBe(false);
      if (!response.ok) expect(response.error.code).toBe('SESSION_NOT_FOUND');
    }
  });
});
