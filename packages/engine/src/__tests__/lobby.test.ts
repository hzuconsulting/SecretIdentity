import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  DEFAULT_SETTINGS,
  SERVER_EVENTS,
  MAX_PLAYERS,
  TOTAL_ROUNDS,
  type GameError,
  type SessionPayload,
} from '@identite-secrete/shared';
import {
  TEST_GRACE_MS,
  TEST_HOST_TRANSFER_MS,
  TestClient,
  containsValue,
  startTestServer,
  wait,
  type TestHost,
} from './helpers';

let server: TestHost;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = TestClient.connect(server);
  clients.push(client);
  return client;
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

describe('création de partie', () => {
  it('rend un code, un identifiant de joueur et un jeton de session', async () => {
    const host = await connect();
    const session = await host.createGame('Sarah');

    expect(session.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
    expect(session.playerId).toHaveLength(36);
    expect(session.sessionToken.length).toBeGreaterThan(20);
  });

  it('envoie immédiatement sa vue au créateur, qui est hôte', async () => {
    const host = await connect();
    await host.createGame('Sarah');

    const view = await host.waitForView((v) => v.players.length === 1, 'salon à 1 joueur');

    expect(view.phase).toBe('LOBBY');
    expect(view.you.isHost).toBe(true);
    expect(view.you.nickname).toBe('Sarah');
    expect(view.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('refuse un pseudo vide', async () => {
    const host = await connect();
    const response = await host.emit<SessionPayload>(CLIENT_EVENTS.createGame, {
      nickname: '   ',
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_NICKNAME');
  });

  it('attribue des codes distincts à des parties simultanées', async () => {
    const a = await connect();
    const b = await connect();

    const codeA = (await a.createGame('Sarah')).code;
    const codeB = (await b.createGame('Allan')).code;

    expect(codeA).not.toBe(codeB);
  });
});

// ─────────────────────────────────────────────────────────────

describe('jointure', () => {
  it('met à jour la liste des joueurs chez tout le monde, en temps réel', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const hostView = await host.waitForView((v) => v.players.length === 2, 'hôte voit 2 joueurs');
    const guestView = await guest.waitForView((v) => v.players.length === 2, 'invité voit 2 joueurs');

    expect(hostView.players.map((p) => p.nickname)).toEqual(['Sarah', 'Allan']);
    expect(guestView.you.isHost).toBe(false);
    expect(guestView.players.find((p) => p.nickname === 'Sarah')?.isHost).toBe(true);
  });

  it('accepte un code en minuscules et avec des espaces', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const guest = await connect();
    const session = await guest.joinGame(` ${code.toLowerCase()} `, 'Allan');

    expect(session.code).toBe(code);
  });

  it('refuse un code inexistant', async () => {
    const guest = await connect();
    const response = await guest.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
      code: 'ZZZZZ',
      nickname: 'Allan',
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('GAME_NOT_FOUND');
  });

  it('refuse un pseudo déjà pris et propose une variante', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const guest = await connect();
    const response = await guest.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
      code,
      nickname: 'sarah',
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('NICKNAME_TAKEN');
      expect(response.error.suggestion).toBe('sarah2');
    }
  });

  it('refuse un neuvième joueur', async () => {
    const host = await connect();
    const { code } = await host.createGame('J1');

    for (let i = 2; i <= MAX_PLAYERS; i++) {
      const guest = await connect();
      await guest.joinGame(code, `J${i}`);
    }

    const extra = await connect();
    const response = await extra.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
      code,
      nickname: 'J9',
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('GAME_FULL');
  });
});

// ─────────────────────────────────────────────────────────────

describe('paramètres', () => {
  it('rediffuse une modification de l’hôte à tous les joueurs', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const response = await host.emit(CLIENT_EVENTS.updateSettings, {
      guessSeconds: 45,
      difficulty: 'hard',
    });
    expect(response.ok).toBe(true);

    const guestView = await guest.waitForView(
      (v) => v.settings.guessSeconds === 45,
      'invité reçoit les nouveaux paramètres',
    );

    expect(guestView.settings.difficulty).toBe('hard');
    // Les paramètres non touchés ne bougent pas.
    expect(guestView.settings.clueSeconds).toBe(DEFAULT_SETTINGS.clueSeconds);
    // Le nombre de manches, lui, est fixé par les règles.
    expect(guestView.totalRounds).toBe(TOTAL_ROUNDS);
  });

  it('refuse une modification venant d’un non-hôte', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const response = await guest.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 30 });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('NOT_HOST');

    const game = await server.store.get(code);
    expect(game?.settings.guessSeconds).toBe(DEFAULT_SETTINGS.guessSeconds);
  });

  it('refuse une valeur hors options', async () => {
    const host = await connect();
    await host.createGame('Sarah');

    const response = await host.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 7 });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });
});

// ─────────────────────────────────────────────────────────────

describe('déconnexion et reconnexion', () => {
  it('marque le joueur déconnecté sans le retirer tout de suite', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');
    await host.waitForView((v) => v.players.length === 2, 'salon à 2');

    guest.disconnect();

    const view = await host.waitForView(
      (v) => v.players.some((p) => p.nickname === 'Allan' && !p.connected),
      'Allan marqué déconnecté',
    );

    expect(view.players).toHaveLength(2);
  });

  it('restaure la session exacte via le jeton', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    const session = await guest.joinGame(code, 'Allan');

    guest.disconnect();

    const revenant = await connect();
    const response = await revenant.emit<SessionPayload>(CLIENT_EVENTS.rejoinGame, {
      sessionToken: session.sessionToken,
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data.playerId).toBe(session.playerId);
      expect(response.data.code).toBe(code);
    }

    const view = await revenant.waitForView(
      (v) => v.you.nickname === 'Allan' && v.you.connected,
      'Allan reconnecté',
    );
    expect(view.players).toHaveLength(2);
  });

  it('retire le joueur à l’expiration de la période de grâce', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');
    await host.waitForView((v) => v.players.length === 2, 'salon à 2');

    guest.disconnect();
    await wait(TEST_GRACE_MS * 4);

    const view = await host.waitForView((v) => v.players.length === 1, 'Allan retiré');
    expect(view.players.map((p) => p.nickname)).toEqual(['Sarah']);
  });

  it('annule le retrait si le joueur revient à temps', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    const session = await guest.joinGame(code, 'Allan');

    guest.disconnect();

    const revenant = await connect();
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: session.sessionToken });

    await wait(TEST_GRACE_MS * 4);

    const game = await server.store.get(code);
    expect(game?.players.size).toBe(2);
    expect([...(game?.players.values() ?? [])].every((p) => p.connected)).toBe(true);
  });

  it('refuse un jeton inconnu', async () => {
    const client = await connect();
    const response = await client.emit(CLIENT_EVENTS.rejoinGame, {
      sessionToken: 'jeton-totalement-invente',
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('supprime la partie quand le dernier joueur s’en va', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    await host.emit(CLIENT_EVENTS.leave, {});

    expect(await server.store.get(code)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────

describe('rôle d’hôte', () => {
  it('transfère immédiatement au départ volontaire de l’hôte', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const second = await connect();
    await second.joinGame(code, 'Allan');
    const third = await connect();
    await third.joinGame(code, 'Malo');

    await second.waitForView((v) => v.players.length === 3, 'salon à 3');
    await host.emit(CLIENT_EVENTS.leave, {});

    const view = await second.waitForView(
      (v) => v.players.length === 2 && v.you.isHost,
      'Allan devient hôte',
    );
    expect(view.players.map((p) => p.nickname)).toEqual(['Allan', 'Malo']);
  });

  it('attend le délai avant de transférer sur une simple déconnexion', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const second = await connect();
    await second.joinGame(code, 'Allan');
    await second.waitForView((v) => v.players.length === 2, 'salon à 2');

    host.disconnect();

    const view = await second.waitForView((v) => v.you.isHost, 'Allan devient hôte');
    expect(view.players.find((p) => p.nickname === 'Sarah')?.isHost).toBe(false);
  });

  it('ne transfère pas si l’hôte revient avant le délai', async () => {
    const host = await connect();
    const session = await host.createGame('Sarah');
    const second = await connect();
    await second.joinGame(session.code, 'Allan');

    host.disconnect();

    const revenant = await connect();
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: session.sessionToken });

    await wait(TEST_HOST_TRANSFER_MS * 4);

    const game = await server.store.get(session.code);
    expect(game?.hostId).toBe(session.playerId);
  });

  it('choisit le joueur connecté le plus ancien', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const second = await connect();
    await second.joinGame(code, 'Allan');
    const third = await connect();
    await third.joinGame(code, 'Malo');

    await third.waitForView((v) => v.players.length === 3, 'salon à 3');

    // Allan est plus ancien que Malo, mais déconnecté : c'est Malo qui hérite.
    second.disconnect();
    // La déconnexion est traitée de façon asynchrone : sans cette attente, le
    // départ de l'hôte pourrait être traité alors qu'Allan compte encore comme
    // connecté, et c'est lui qui hériterait du salon.
    await host.waitForView((v) => v.players.some((p) => !p.connected), 'Allan hors ligne');
    await host.emit(CLIENT_EVENTS.leave, {});

    const view = await third.waitForView((v) => v.you.isHost, 'Malo devient hôte');
    expect(view.you.nickname).toBe('Malo');
  });
});

// ─────────────────────────────────────────────────────────────

describe('exclusion par l’hôte', () => {
  /** Un salon à trois, l'hôte en tête. */
  async function lobby(): Promise<{ code: string; players: TestClient[] }> {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const players = [host];

    for (const nickname of ['Allan', 'Malo']) {
      const guest = await connect();
      await guest.joinGame(code, nickname);
      players.push(guest);
    }

    await host.waitForView((v) => v.players.length === 3, 'salon à 3');
    return { code, players };
  }

  it('retire le joueur et prévient tout le monde', async () => {
    const { code, players } = await lobby();
    const [host, allan] = players as [TestClient, TestClient];

    const kicked = new Promise<GameError>((resolve) => {
      allan.on<GameError>(SERVER_EVENTS.kicked, resolve);
    });

    const response = await host.emit(CLIENT_EVENTS.kickPlayer, {
      playerId: allan.session!.playerId,
    });
    expect(response.ok).toBe(true);

    // L'exclu est prévenu personnellement, avant d'être retiré.
    expect((await kicked).code).toBe('KICKED');

    // Et il a bien disparu du salon des autres. L'acquittement arrive après la
    // diffusion : la dernière vue de l'hôte est déjà celle d'après l'exclusion.
    expect(host.lastView.players.map((player) => player.nickname).sort()).toEqual([
      'Malo',
      'Sarah',
    ]);

    const game = await server.store.get(code);
    expect(game!.players.has(allan.session!.playerId)).toBe(false);
  });

  it('empêche le retour de l’exclu, par session comme par pseudo', async () => {
    const { code, players } = await lobby();
    const [host, allan] = players as [TestClient, TestClient];
    const session = allan.session!;

    await host.emit(CLIENT_EVENTS.kickPlayer, { playerId: session.playerId });

    // Son jeton ne correspond plus à personne.
    const revenant = await connect();
    const rejoin = await revenant.emit(CLIENT_EVENTS.rejoinGame, {
      sessionToken: session.sessionToken,
    });
    expect(rejoin.ok).toBe(false);
    if (!rejoin.ok) expect(rejoin.error.code).toBe('SESSION_NOT_FOUND');

    // Et son pseudo est banni — la casse ne suffit pas à le contourner.
    for (const nickname of ['Allan', 'allan', '  ALLAN  ']) {
      const retry = await revenant.emit(CLIENT_EVENTS.joinGame, { code, nickname });
      expect(retry.ok, nickname).toBe(false);
      if (!retry.ok) expect(retry.error.code).toBe('KICKED');
    }

    // Un nouveau venu, lui, entre normalement.
    const newcomer = await connect();
    expect((await newcomer.emit(CLIENT_EVENTS.joinGame, { code, nickname: 'Zoé' })).ok).toBe(
      true,
    );
  });

  it('refuse l’exclusion par un non-hôte', async () => {
    const { players } = await lobby();
    const [host, allan] = players as [TestClient, TestClient];

    const response = await allan.emit(CLIENT_EVENTS.kickPlayer, {
      playerId: host.session!.playerId,
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('NOT_HOST');
  });

  it('refuse à l’hôte de s’exclure lui-même', async () => {
    const { players } = await lobby();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.kickPlayer, {
      playerId: host.session!.playerId,
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('est idempotent sur un joueur déjà parti', async () => {
    const { players } = await lobby();
    const [host, allan] = players as [TestClient, TestClient];

    await host.emit(CLIENT_EVENTS.kickPlayer, { playerId: allan.session!.playerId });
    const again = await host.emit(CLIENT_EVENTS.kickPlayer, {
      playerId: allan.session!.playerId,
    });

    expect(again.ok).toBe(true);
  });

  it('supprime la partie si l’hôte exclut tout le monde puis s’en va', async () => {
    const { code, players } = await lobby();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];

    await host.emit(CLIENT_EVENTS.kickPlayer, { playerId: allan.session!.playerId });
    await host.emit(CLIENT_EVENTS.kickPlayer, { playerId: malo.session!.playerId });
    await host.emit(CLIENT_EVENTS.leave, {});

    expect(await server.store.get(code)).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────

describe('confidentialité des payloads', () => {
  it('n’envoie jamais le jeton de session d’un joueur à un autre', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    const guestSession = await guest.joinGame(code, 'Allan');

    await host.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 45 });
    await host.waitForView((v) => v.settings.guessSeconds === 45, 'paramètres diffusés');

    for (const payload of host.allPayloads) {
      expect(containsValue(payload, guestSession.sessionToken)).toBe(false);
    }
    expect(host.allPayloads.length).toBeGreaterThan(0);
  });

  it('ne laisse fuir aucun champ secret dans une vue de salon', async () => {
    const host = await connect();
    await host.createGame('Sarah');
    const view = await host.waitForView((v) => v.players.length === 1, 'salon à 1');

    const serialized = JSON.stringify(view);
    for (const secret of ['sessionToken', 'labelMap', 'connectionId', 'usedIdentityIds']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('n’expose que les champs publics d’un joueur', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const view = await host.waitForView((v) => v.players.length === 2, 'salon à 2');
    const other = view.players.find((p) => p.nickname === 'Allan');

    expect(Object.keys(other ?? {}).sort()).toEqual([
      'away',
      'cardsLeft',
      'connected',
      'id',
      'isHost',
      'nickname',
      'score',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────

describe('robustesse', () => {
  it('rejette une action sans session, sans planter', async () => {
    const client = await connect();
    const response = await client.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 45 });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('traite un double départ de façon idempotente', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const first = await guest.emit(CLIENT_EVENTS.leave, {});
    const second = await guest.emit(CLIENT_EVENTS.leave, {});

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const game = await server.store.get(code);
    expect(game?.players.size).toBe(1);
  });

  it('ignore un payload malformé sans fermer la connexion', async () => {
    const host = await connect();
    await host.createGame('Sarah');

    const response = await host.emit(CLIENT_EVENTS.updateSettings, 'pas un objet');
    expect(response.ok).toBe(false);

    // La socket vit toujours et répond encore.
    const next = await host.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 30 });
    expect(next.ok).toBe(true);
  });
});
