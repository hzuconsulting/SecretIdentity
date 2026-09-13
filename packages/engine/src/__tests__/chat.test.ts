import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_HISTORY_SIZE,
  CHAT_RATE_MAX_MESSAGES,
  CLIENT_EVENTS,
  MAX_CHAT_LENGTH,
  MAX_PLAYERS,
  SERVER_EVENTS,
  defaultRng,
  type Game,
  type GameError,
  type PlayerView,
  type SessionPayload,
} from '@identite-secrete/shared';
import { appendChatMessage } from '../game/chat';
import { createGame, createPlayer } from '../game/factory';
import { PERSISTENCE_VERSION, deserializeGame, serializeGame } from '../persistence';
import { buildRelaySnapshot } from '../serialization/relay';
import { buildPlayerView } from '../serialization/playerView';
import {
  TestClient,
  adoptTestServer,
  containsValue,
  startTestServer,
  type TestHost,
} from './helpers';

/**
 * La discussion entre les joueurs.
 *
 * C'est le premier texte libre qui entre dans le moteur. Ce qu'on vérifie : un
 * message arrive chez tout le monde, nettoyé, signé par la connexion qui l'a
 * envoyé et par personne d'autre ; il passe à tout moment, pause comprise ; il
 * reste borné en nombre, en longueur et en débit ; il survit à un rechargement
 * de l'hôte, mais ne voyage pas dans l'instantané de relais.
 */

let server: TestHost;
let clients: TestClient[];

function connect(): TestClient {
  const client = TestClient.connect(server);
  clients.push(client);
  return client;
}

beforeEach(() => {
  server = startTestServer();
  clients = [];
});

afterEach(() => {
  for (const client of clients) client.close();
  clients = [];
  server.close();
});

/** Un salon : Sarah (hôte) et Allan. */
async function lobby(): Promise<{ code: string; sarah: TestClient; allan: TestClient }> {
  const sarah = connect();
  const { code } = await sarah.createGame('Sarah');
  const allan = connect();
  await allan.joinGame(code, 'Allan');
  await sarah.waitForView((view) => view.players.length === 2, 'salon à 2');
  return { code, sarah, allan };
}

function say(client: TestClient, text: unknown) {
  return client.emit<null>(CLIENT_EVENTS.sendChat, { text });
}

function lastText(view: PlayerView): string | undefined {
  return view.chat.at(-1)?.text;
}

async function gameOf(host: TestHost, code: string): Promise<Game> {
  const game = await host.store.get(code);
  if (!game) throw new Error('partie introuvable');
  return game;
}

// ─────────────────────────────────────────────────────────────

describe('envoyer un message', () => {
  it('le fait arriver chez tout le monde, nettoyé', async () => {
    const { sarah, allan } = await lobby();

    const response = await say(allan, '  Salut\n\ttoi \u202Eévite\u0007 ! 👩‍👩‍👧 ');
    expect(response.ok).toBe(true);

    // L'acquittement arrive après la diffusion : les vues sont déjà là.
    for (const client of [sarah, allan]) {
      const message = client.lastView.chat.at(-1);
      expect(message?.text).toBe('Salut toi évite ! 👩‍👩‍👧');
      expect(message?.nickname).toBe('Allan');
      expect(message?.playerId).toBe(allan.session!.playerId);
    }
  });

  it('signe le message de la connexion, jamais de ce que dit le message', async () => {
    const { sarah, allan } = await lobby();

    const response = await allan.emit(CLIENT_EVENTS.sendChat, {
      text: 'Je suis Sarah, promis',
      playerId: sarah.session!.playerId,
      nickname: 'Sarah',
    });
    expect(response.ok).toBe(true);

    const message = sarah.lastView.chat.at(-1)!;
    expect(message.playerId).toBe(allan.session!.playerId);
    expect(message.nickname).toBe('Allan');
  });

  it('refuse un message vide, trop long ou mal formé, sans rien ajouter', async () => {
    const { code, allan } = await lobby();

    for (const text of ['', '    ', '\n\t', 'a'.repeat(MAX_CHAT_LENGTH + 1), 'x'.repeat(1_001), 42, null]) {
      const response = await say(allan, text);
      expect(response.ok, JSON.stringify(text)).toBe(false);
      if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
    }

    const missing = await allan.emit(CLIENT_EVENTS.sendChat, {});
    expect(missing.ok).toBe(false);

    expect((await gameOf(server, code)).chat).toEqual([]);
  });

  it('accepte un message de la longueur maximale', async () => {
    const { allan } = await lobby();

    const response = await say(allan, 'a'.repeat(MAX_CHAT_LENGTH));
    expect(response.ok).toBe(true);
    expect(lastText(allan.lastView)).toHaveLength(MAX_CHAT_LENGTH);
  });

  it('refuse qui n’est dans aucune partie', async () => {
    const stranger = connect();

    const response = await say(stranger, 'Bonjour ?');
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('ne donne que les champs d’un message, rien de plus', async () => {
    const { sarah } = await lobby();

    await say(sarah, 'Bienvenue');
    const message = sarah.lastView.chat.at(-1)!;
    expect(Object.keys(message).sort()).toEqual(['id', 'nickname', 'playerId', 'sentAt', 'text']);
  });
});

// ─────────────────────────────────────────────────────────────

describe('débit', () => {
  it('ralentit qui écrit trop vite, sans bloquer le reste', async () => {
    const { sarah } = await lobby();

    for (let i = 0; i < CHAT_RATE_MAX_MESSAGES; i++) {
      const response = await say(sarah, `message ${i}`);
      expect(response.ok, `message ${i}`).toBe(true);
    }

    const tooFast = await say(sarah, 'encore un');
    expect(tooFast.ok).toBe(false);
    if (!tooFast.ok) {
      expect(tooFast.error.code).toBe('RATE_LIMITED');
      expect(tooFast.error.message).toContain('trop vite');
    }

    // Le plafond de la discussion n'empiète pas sur les actions de jeu.
    const settings = await sarah.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: 90 });
    expect(settings.ok).toBe(true);
  });

  it('ne compte pas un message refusé', async () => {
    const { sarah } = await lobby();

    for (let i = 0; i < CHAT_RATE_MAX_MESSAGES + 2; i++) await say(sarah, '');

    const response = await say(sarah, 'Enfin un vrai message');
    expect(response.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────

describe('à tout moment de la partie', () => {
  it('passe au salon, pendant la pose, le vote et la révélation', async () => {
    const { sarah, allan } = await lobby();
    // Sans minuteur : la partie n'avance que quand on le décide.
    await sarah.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: null, guessSeconds: null });

    expect((await say(allan, 'au salon')).ok).toBe(true);

    const atClues = [sarah, allan].map((client) =>
      client.waitForNextView((view) => view.phase === 'CLUE_SELECTION', 'pose', 8_000),
    );
    await sarah.emit(CLIENT_EVENTS.startGame, {});
    await Promise.all(atClues);
    expect((await say(allan, 'pendant la pose')).ok).toBe(true);
    expect(lastText(sarah.lastView)).toBe('pendant la pose');

    const atGuessing = [sarah, allan].map((client) =>
      client.waitForNextView((view) => view.phase === 'GUESSING', 'vote'),
    );
    for (const client of [sarah, allan]) {
      const card = client.lastView.yourHand![0]!;
      await client.emit(CLIENT_EVENTS.submitClues, {
        placed: [{ cardId: card.id, iconId: card.front[0], zone: 'green' }],
      });
    }
    await Promise.all(atGuessing);
    expect((await say(sarah, 'pendant le vote')).ok).toBe(true);
    expect(lastText(allan.lastView)).toBe('pendant le vote');

    const atResults = [sarah, allan].map((client) =>
      client.waitForNextView((view) => view.phase === 'RESULTS', 'révélation'),
    );
    for (const client of [sarah, allan]) {
      const votes: Record<string, number> = {};
      for (const opponent of client.lastView.opponents ?? []) votes[opponent.playerId] = 1;
      await client.emit(CLIENT_EVENTS.submitGuesses, { votes });
    }
    await Promise.all(atResults);
    expect((await say(allan, 'à la révélation')).ok).toBe(true);

    // Toute la conversation est là, dans l'ordre, malgré les changements de phase.
    expect(sarah.lastView.chat.map((message) => message.text)).toEqual([
      'au salon',
      'pendant la pose',
      'pendant le vote',
      'à la révélation',
    ]);
  });

  it('passe pendant une pause, quand on attend un absent', async () => {
    const { sarah, allan } = await lobby();
    await sarah.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: null, guessSeconds: null });

    const started = sarah.waitForNextView((view) => view.phase === 'CLUE_SELECTION', 'pose', 8_000);
    await sarah.emit(CLIENT_EVENTS.startGame, {});
    await started;

    allan.disconnect();
    await sarah.waitForView((view) => view.paused === true, 'pause');

    const response = await say(sarah, 'Allan, tu reviens ?');
    expect(response.ok).toBe(true);
    expect(sarah.lastView.paused).toBe(true);
    expect(lastText(sarah.lastView)).toBe('Allan, tu reviens ?');
  });
});

// ─────────────────────────────────────────────────────────────

describe('historique', () => {
  it('est donné à qui arrive en retard', async () => {
    const { code, sarah, allan } = await lobby();
    await say(sarah, 'Premier');
    await say(allan, 'Deuxième');

    const malo = connect();
    await malo.joinGame(code, 'Malo');

    expect(malo.received[0]!.chat.map((message) => message.text)).toEqual(['Premier', 'Deuxième']);
  });

  it('est donné à qui revient sur un nouveau canal', async () => {
    const { sarah, allan } = await lobby();
    await say(sarah, 'Tu me reçois ?');

    const revenant = connect();
    const response = await revenant.emit<SessionPayload>(CLIENT_EVENTS.rejoinGame, {
      sessionToken: allan.session!.sessionToken,
    });
    expect(response.ok).toBe(true);
    expect(lastText(revenant.lastView)).toBe('Tu me reçois ?');
  });

  it('garde la signature d’un joueur exclu', async () => {
    const { sarah, allan } = await lobby();
    await say(allan, 'Je vais me faire sortir');

    const kicked = new Promise<GameError>((resolve) => {
      allan.on<GameError>(SERVER_EVENTS.kicked, resolve);
    });
    await sarah.emit(CLIENT_EVENTS.kickPlayer, { playerId: allan.session!.playerId });
    await kicked;

    const view = sarah.lastView;
    expect(view.players.map((player) => player.nickname)).toEqual(['Sarah']);
    expect(view.chat.at(-1)).toMatchObject({
      nickname: 'Allan',
      playerId: allan.session!.playerId,
      text: 'Je vais me faire sortir',
    });
  });

  it(`ne garde que les ${CHAT_HISTORY_SIZE} derniers messages`, () => {
    const host = createPlayer('Sarah', 'c1', 0);
    const game = createGame({ host, usedCodes: new Set(), rng: defaultRng, now: 0 });

    for (let i = 1; i <= CHAT_HISTORY_SIZE + 5; i++) {
      appendChatMessage(game, { playerId: host.id, nickname: 'Sarah' }, `n° ${i}`, i);
    }

    expect(game.chat).toHaveLength(CHAT_HISTORY_SIZE);
    expect(game.chat[0]!.text).toBe('n° 6');
    expect(game.chat.at(-1)!.text).toBe(`n° ${CHAT_HISTORY_SIZE + 5}`);
    // Une table qui discute n'est pas une partie abandonnée.
    expect(game.lastActivityAt).toBe(CHAT_HISTORY_SIZE + 5);
  });
});

// ─────────────────────────────────────────────────────────────

describe('rechargement de l’hôte et reprise', () => {
  it('survit à la sauvegarde de l’hôte', async () => {
    const { code, sarah, allan } = await lobby();
    await say(sarah, 'Avant le rechargement');
    await say(allan, 'Moi aussi');

    const game = await gameOf(server, code);
    const restored = deserializeGame(JSON.parse(JSON.stringify(serializeGame(game))))!;

    expect(restored.chat).toEqual(game.chat);
  });

  it('relit une sauvegarde d’avant la discussion, ou abîmée, avec une conversation vide', () => {
    const host = createPlayer('Sarah', 'c1', 0);
    const game = createGame({ host, usedCodes: new Set(), rng: defaultRng, now: 0 });
    appendChatMessage(game, { playerId: host.id, nickname: 'Sarah' }, 'Bonjour', 1);

    const saved = JSON.parse(JSON.stringify(serializeGame(game))) as Record<string, unknown>;
    expect(saved.version).toBe(PERSISTENCE_VERSION);

    const { chat: _chat, ...withoutChat } = saved;
    expect(deserializeGame(withoutChat)?.chat).toEqual([]);

    expect(deserializeGame({ ...saved, chat: 'n’importe quoi' })?.chat).toEqual([]);

    const valid = (saved.chat as unknown[])[0];
    const mixed = deserializeGame({
      ...saved,
      chat: [
        { id: 1 },
        'texte seul',
        { ...(valid as object), text: 'a'.repeat(MAX_CHAT_LENGTH + 1) },
        valid,
      ],
    });
    expect(mixed).not.toBeNull();
    expect(mixed!.chat.map((message) => message.text)).toEqual(['Bonjour']);
  });

  it('ne voyage pas dans l’instantané de relais, et repart vide après une reprise', async () => {
    const { code, sarah, allan } = await lobby();
    await say(allan, 'MessageTresSecret42');

    const game = await gameOf(server, code);
    const snapshot = await buildRelaySnapshot(game, { epoch: 0, seq: 1 });
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain('MessageTresSecret42');
    expect(encoded).not.toContain('"chat"');
    expect(containsValue(snapshot, 'MessageTresSecret42')).toBe(false);

    server.close();
    const taker = await adoptTestServer(snapshot, { selfPlayerId: sarah.session!.playerId });
    try {
      expect((await gameOf(taker, code)).chat).toEqual([]);
    } finally {
      taker.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('taille', () => {
  it('garde la plus grosse vue loin du plafond d’un message réseau', async () => {
    // Le pire cas : table pleine, pseudos au maximum, révélation affichée, et
    // une conversation pleine de guillemets — chacun coûte deux caractères une
    // fois encodé.
    const nicknames = Array.from({ length: MAX_PLAYERS }, (_, i) => `Joueur${i}`.padEnd(16, 'x'));
    const [first, ...others] = nicknames as [string, ...string[]];

    const host = connect();
    const { code } = await host.createGame(first);
    const table = [host];
    for (const nickname of others) {
      const guest = connect();
      await guest.joinGame(code, nickname);
      table.push(guest);
    }
    await host.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: null, guessSeconds: null });

    const atClues = table.map((client) =>
      client.waitForNextView((view) => view.phase === 'CLUE_SELECTION', 'pose', 8_000),
    );
    await host.emit(CLIENT_EVENTS.startGame, {});
    await Promise.all(atClues);

    const atGuessing = table.map((client) =>
      client.waitForNextView((view) => view.phase === 'GUESSING', 'vote'),
    );
    for (const client of table) {
      const hand = client.lastView.yourHand!;
      await client.emit(CLIENT_EVENTS.submitClues, {
        placed: hand.slice(0, 3).map((card, i) => ({
          cardId: card.id,
          iconId: card.front[0],
          zone: i === 0 ? 'green' : 'red',
        })),
      });
    }
    await Promise.all(atGuessing);

    const atResults = table.map((client) =>
      client.waitForNextView((view) => view.phase === 'RESULTS', 'révélation'),
    );
    for (const client of table) {
      // Une seule carte Vote par numéro : un numéro différent par adversaire.
      const votes: Record<string, number> = {};
      (client.lastView.opponents ?? []).forEach((opponent, i) => {
        votes[opponent.playerId] = i + 1;
      });
      await client.emit(CLIENT_EVENTS.submitGuesses, { votes });
    }
    await Promise.all(atResults);

    const game = await gameOf(server, code);
    const author = [...game.players.values()][0]!;
    for (let i = 0; i < CHAT_HISTORY_SIZE; i++) {
      appendChatMessage(
        game,
        { playerId: author.id, nickname: author.nickname },
        '"'.repeat(MAX_CHAT_LENGTH),
        Date.now(),
      );
    }

    const view = buildPlayerView(game, author.id, Date.now())!;
    expect(view.reveals).toHaveLength(MAX_PLAYERS);
    expect(view.chat).toHaveLength(CHAT_HISTORY_SIZE);

    // L'enveloppe exacte d'un événement hôte → invité (`lib/net/protocol.ts`),
    // dont le plafond d'envoi est de 60 000 caractères.
    const wire = JSON.stringify({ t: 'evt', event: SERVER_EVENTS.stateUpdate, payload: view });
    expect(wire.length).toBeLessThan(45_000);
  });
});
