import { describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, type PlayerView } from '@identite-secrete/shared';
import { GameHost } from '../host';
import { InMemoryStore } from '../store/InMemoryStore';
import { deserializeGame, serializeGame } from '../persistence';
import { TestClient, TestHost, startTestServer, wait } from './helpers';

/**
 * Survie d'une partie au rechargement de l'onglet qui l'héberge.
 *
 * C'est le scénario que le serveur rendait impossible et que le pair à pair
 * rend banal : le téléphone de l'hôte recharge sa page — parce qu'il l'a
 * demandé, ou parce que le système a recyclé l'onglet — et le moteur doit
 * repartir exactement où il en était, sans que les autres joueurs aient à
 * retaper quoi que ce soit.
 */

/** Une partie à trois joueurs, amenée jusqu'à la sélection des indices. */
async function startedGame(server: TestHost): Promise<{
  code: string;
  players: TestClient[];
}> {
  const host = TestClient.connect(server);
  const { code } = await host.createGame('Sarah');
  const players = [host];

  for (const nickname of ['Allan', 'Malo']) {
    const guest = TestClient.connect(server);
    await guest.joinGame(code, nickname);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === 3, 'salon à 3');
  await host.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: 90, guessSeconds: 90 });
  await host.emit(CLIENT_EVENTS.startGame, {});

  for (const client of players) {
    await client.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
      'sélection des indices',
      8_000,
    );
  }

  return { code, players };
}

// ─────────────────────────────────────────────────────────────

describe('aller-retour de sérialisation', () => {
  it('restitue les structures que JSON perd en silence', async () => {
    const server = startTestServer();
    try {
      const { code } = await startedGame(server);

      const before = (await server.store.get(code))!;
      const after = deserializeGame(JSON.parse(JSON.stringify(serializeGame(before))))!;

      expect(after).not.toBeNull();
      // `Map` et `Set` deviennent `{}` avec un `JSON.stringify` naïf : c'est
      // précisément ce que la conversion manuelle évite.
      expect(after.players).toBeInstanceOf(Map);
      expect(after.players.size).toBe(before.players.size);
      expect(after.usedIdentityIds).toBeInstanceOf(Set);
      expect([...after.usedIdentityIds]).toEqual([...before.usedIdentityIds]);

      const round = after.rounds[after.currentRound - 1]!;
      const original = before.rounds[before.currentRound - 1]!;
      expect(round.assignments).toBeInstanceOf(Map);
      expect(round.assignments.size).toBe(original.assignments.size);
      expect(round.board).toEqual(original.board);

      for (const [playerId, assignment] of original.assignments) {
        expect(round.assignments.get(playerId)?.slot).toBe(assignment.slot);
        expect(round.assignments.get(playerId)?.placed).toEqual(assignment.placed);
      }

      // Les mains vivent sur le joueur, et traversent la sauvegarde intactes.
      for (const [playerId, player] of before.players) {
        expect(after.players.get(playerId)?.hand).toEqual(player.hand);
      }
    } finally {
      server.close();
    }
  });

  it('ramène tout le monde déconnecté, jetons de session intacts', async () => {
    const server = startTestServer();
    try {
      const { code } = await startedGame(server);
      const before = (await server.store.get(code))!;

      const after = deserializeGame(serializeGame(before))!;

      for (const player of after.players.values()) {
        // Les canaux n'existent plus : les prétendre ouverts ferait attendre la
        // partie sur des joueurs qui ne recevraient rien.
        expect(player.connected).toBe(false);
        expect(player.connectionId).toBeNull();
        // Le jeton, lui, doit survivre : c'est ce qui reconnecte les joueurs
        // sans leur redemander leur pseudo.
        expect(player.sessionToken).toBe(before.players.get(player.id)!.sessionToken);
      }
    } finally {
      server.close();
    }
  });

  it('refuse une sauvegarde corrompue plutôt que de la charger à moitié', () => {
    expect(deserializeGame(null)).toBeNull();
    expect(deserializeGame('texte')).toBeNull();
    expect(deserializeGame({})).toBeNull();
    expect(deserializeGame({ version: 2, code: 'ABCDE' })).toBeNull();
    expect(deserializeGame({ version: 1, code: 'ABCDE', hostId: 'x' })).toBeNull();
    expect(
      deserializeGame({
        version: 1,
        code: 'ABCDE',
        hostId: 'x',
        phase: 'PAS_UNE_PHASE',
        players: [{ id: 'x' }],
        settings: {},
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────

describe('reprise du moteur après rechargement', () => {
  it('reprend la manche en cours et laisse les joueurs revenir avec leur jeton', async () => {
    const first = startTestServer();
    let sessions: string[] = [];
    let identities: string[] = [];
    let saved: unknown;

    try {
      const started = await startedGame(first);
      sessions = started.players.map((player) => player.session!.sessionToken);

      const game = (await first.store.get(started.code))!;
      const round = game.rounds[game.currentRound - 1]!;
      identities = [...round.assignments.values()].map((a) => round.board[a.slot - 1]!);

      // L'onglet de l'hôte disparaît : c'est tout ce qu'on garde de la partie.
      saved = JSON.parse(JSON.stringify(serializeGame(game)));
    } finally {
      first.close();
    }

    // Nouveau nœud, alimenté par la seule sauvegarde.
    const store = new InMemoryStore();
    await store.create(deserializeGame(saved)!);

    const second = new TestHost({ store });
    try {
      const revenants = sessions.map(() => TestClient.connect(second));

      for (const [index, client] of revenants.entries()) {
        const response = await client.emit(CLIENT_EVENTS.rejoinGame, {
          sessionToken: sessions[index],
        });
        expect(response.ok, `reconnexion du joueur ${index}`).toBe(true);
      }

      for (const client of revenants) {
        const view = await client.waitForView(
          (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
          'manche reprise',
        );
        // Personne ne repart de zéro : la manche et l'identité sont les mêmes.
        expect(view.roundNumber).toBe(1);
        expect(identities).toContain(view.yourIdentityId);
      }
    } finally {
      second.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('rattrapage des échéances gelées', () => {
  it('avance la phase quand le minuteur n’a pas pu se déclencher', async () => {
    // Sans mise à l'échelle : le minuteur n'aura pas le temps de tirer, ce qui
    // simule un onglet gelé par le système. Seul `tick` peut alors débloquer.
    const server = new TestHost({ timeScale: 1 });

    try {
      const host = TestClient.connect(server);
      const { code } = await host.createGame('Sarah');
      for (const nickname of ['Allan', 'Malo']) {
        await TestClient.connect(server).joinGame(code, nickname);
      }

      await host.waitForView((v) => v.players.length === 3, 'salon à 3');
      await host.emit(CLIENT_EVENTS.startGame, {});
      await host.waitForView((v) => v.phase === 'IDENTITY_REVEAL', 'révélation');

      const game = (await server.store.get(code))!;
      const round = game.rounds[game.currentRound - 1]!;

      // Le téléphone est resté verrouillé au-delà de l'échéance.
      round.phaseEndsAt = Date.now() - 1_000;
      expect(game.phase).toBe('IDENTITY_REVEAL');

      const advanced = await server.host.tickAll();
      expect(advanced).toBeUndefined();

      const view = await host.waitForView(
        (v: PlayerView) => v.phase === 'CLUE_SELECTION',
        'phase rattrapée',
      );
      expect(view.yourHand).toBeDefined();
    } finally {
      server.close();
    }
  });

  it('ne touche à rien tant que l’échéance n’est pas passée', async () => {
    const server = new TestHost({ timeScale: 1 });

    try {
      const host = TestClient.connect(server);
      const { code } = await host.createGame('Sarah');
      for (const nickname of ['Allan', 'Malo']) {
        await TestClient.connect(server).joinGame(code, nickname);
      }

      await host.waitForView((v) => v.players.length === 3, 'salon à 3');
      await host.emit(CLIENT_EVENTS.startGame, {});
      await host.waitForView((v) => v.phase === 'IDENTITY_REVEAL', 'révélation');

      await server.host.tickAll();
      await wait(20);

      expect((await server.store.get(code))!.phase).toBe('IDENTITY_REVEAL');
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('canal fermé en retard', () => {
  it('ne déclare pas absent un joueur déjà revenu sur un autre canal', async () => {
    const server = startTestServer();

    try {
      const host = TestClient.connect(server);
      const { code } = await host.createGame('Sarah');

      const guest = TestClient.connect(server);
      const session = await guest.joinGame(code, 'Allan');
      await host.waitForView((v) => v.players.length === 2, 'salon à 2');

      // Le nouveau canal s'ouvre **avant** que l'ancien n'annonce sa fermeture :
      // c'est l'ordre habituel en WebRTC quand on change de réseau.
      const revenant = TestClient.connect(server);
      const rejoined = await revenant.emit(CLIENT_EVENTS.rejoinGame, {
        sessionToken: session.sessionToken,
      });
      expect(rejoined.ok).toBe(true);

      guest.close();
      await wait(50);

      const game = (await server.store.get(code))!;
      const player = game.players.get(session.playerId)!;
      expect(player.connected).toBe(true);
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('événements inconnus', () => {
  it('rejette un nom d’événement inventé sans casser le nœud', async () => {
    const server = startTestServer();

    try {
      const host = TestClient.connect(server);
      await host.createGame('Sarah');

      const response = await host.emit('game:auto-win', { cheat: true });
      expect(response.ok).toBe(false);

      // Le nœud répond toujours après coup.
      const still = await host.emit(CLIENT_EVENTS.updateSettings, { guessSeconds: 45 });
      expect(still.ok).toBe(true);
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('GameHost fermé', () => {
  it('cesse de répondre et n’émet plus rien', async () => {
    const received: string[] = [];
    const host = new GameHost({
      enableCleanup: false,
      emit: (_id, event) => received.push(event),
    });

    host.connect('c1');
    const created = await host.dispatch('c1', CLIENT_EVENTS.createGame, { nickname: 'Sarah' });
    expect(created.ok).toBe(true);
    expect(received.length).toBeGreaterThan(0);

    const before = received.length;
    host.close();

    const after = await host.dispatch('c1', CLIENT_EVENTS.createGame, { nickname: 'Allan' });
    expect(after.ok).toBe(false);
    expect(received).toHaveLength(before);
  });
});
