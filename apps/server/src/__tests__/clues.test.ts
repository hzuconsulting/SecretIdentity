import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, DEFAULT_SETTINGS, type PlayerView } from '@identite-secrete/shared';
import type { GameServer } from '../server';
import { TestClient, containsValue, startTestServer } from './helpers';

/**
 * Sélection et validation des indices (Lot 3).
 *
 * Les parties sont lancées avec des minuteurs longs (90 s, ramenés à 900 ms par
 * `TEST_TIME_SCALE`) : on veut tester les soumissions **pendant** la phase, pas
 * la course avec son échéance — qui a son propre test.
 */

let server: GameServer;
let url: string;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(url);
  clients.push(client);
  return client;
}

interface Started {
  code: string;
  players: TestClient[];
}

async function startedGame(
  options: { clueSeconds?: number | null; playerCount?: number } = {},
): Promise<Started> {
  const playerCount = options.playerCount ?? 3;
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const players = [host];

  for (const nickname of ['Allan', 'Malo', 'Zoé'].slice(0, playerCount - 1)) {
    const guest = await connect();
    await guest.joinGame(code, nickname);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === playerCount, 'salon complet');
  await host.emit(CLIENT_EVENTS.updateSettings, {
    clueSeconds: options.clueSeconds ?? 90,
    guessSeconds: 90,
  });
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

/** La main d'un joueur, telle qu'il l'a reçue. */
function handOf(client: TestClient): string[] {
  const hand = client.lastView.yourHand;
  if (!hand) throw new Error('main non reçue');
  return hand;
}

beforeEach(async () => {
  const started = await startTestServer();
  server = started.server;
  url = started.url;
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.socket.close();
  clients = [];
  await server.close();
});

// ─────────────────────────────────────────────────────────────

describe('soumission valide', () => {
  it('enregistre la sélection et la renvoie au joueur', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const chosen = handOf(host).slice(0, 3);

    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: chosen });
    expect(response.ok).toBe(true);

    const view = await host.waitForView((v) => v.yourCluesSubmitted === true, 'indices validés');
    expect(view.yourSelectedIcons).toEqual(chosen);
  });

  it('affiche la progression aux autres, sans révéler les icônes', async () => {
    const { players } = await startedGame();
    const [host, allan] = players as [TestClient, TestClient];
    const chosen = handOf(host).slice(0, 2);

    await host.emit(CLIENT_EVENTS.submitClues, { iconIds: chosen });

    const view = await allan.waitForView(
      (v) => v.progress?.some((entry) => entry.submitted) === true,
      'progression de Sarah',
    );

    const sarah = view.progress?.find((entry) => entry.nickname === 'Sarah');
    expect(sarah?.submitted).toBe(true);
    expect(view.progress?.find((entry) => entry.nickname === 'Allan')?.submitted).toBe(false);

    // Les icônes de Sarah ne doivent apparaître dans aucun payload reçu par Allan.
    for (const iconId of chosen) {
      for (const payload of allan.allPayloads) {
        expect(containsValue(payload, iconId), `fuite de ${iconId}`).toBe(false);
      }
    }
  });

  it('accepte une sélection d’un seul indice', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      iconIds: [handOf(host)[0]!],
    });
    expect(response.ok).toBe(true);
  });

  it('conclut la phase dès que tout le monde a validé', async () => {
    const { players } = await startedGame();

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitClues, { iconIds: handOf(client).slice(0, 2) });
    }

    // La phase suivante arrive sans attendre les 900 ms du minuteur.
    const view = await players[0]!.waitForView(
      (v) => v.phase === 'GUESSING',
      'devinette',
      2_000,
    );
    expect(view.clueSets).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation anti-triche', () => {
  it('refuse une icône absente de la main', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const hand = new Set(handOf(host));

    // Une icône du catalogue qui n'est pas dans sa main.
    const intruder = ['crown', 'fire', 'skull', 'pizza', 'rocket'].find((id) => !hand.has(id));
    expect(intruder).toBeDefined();

    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: [intruder!] });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('ICON_NOT_IN_HAND');
  });

  it('refuse la main d’un autre joueur', async () => {
    const { players } = await startedGame();
    const [host, allan] = players as [TestClient, TestClient];

    const foreign = handOf(allan).find((iconId) => !handOf(host).includes(iconId));
    expect(foreign).toBeDefined();

    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: [foreign!] });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('ICON_NOT_IN_HAND');
  });

  it('refuse plus d’indices que le réglage', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      iconIds: handOf(host).slice(0, DEFAULT_SETTINGS.maxClues + 1),
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('TOO_MANY_CLUES');
  });

  it('refuse une sélection vide', async () => {
    const { players } = await startedGame();
    const response = await players[0]!.emit(CLIENT_EVENTS.submitClues, { iconIds: [] });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('refuse deux fois la même icône', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const iconId = handOf(host)[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: [iconId, iconId] });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('n’écrit rien quand la validation échoue', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;

    await host.emit(CLIENT_EVENTS.submitClues, { iconIds: ['icone-inventee'] });

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.selectedIcons).toEqual([]);
    expect(assignment.cluesSubmitted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────

describe('idempotence', () => {
  it('accepte deux fois la même soumission sans effet de bord', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;
    const chosen = handOf(host).slice(0, 2);

    const first = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: chosen });
    const second = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: [...chosen].reverse() });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.selectedIcons).toEqual(chosen);
  });

  it('refuse de changer d’avis après validation', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const hand = handOf(host);

    await host.emit(CLIENT_EVENTS.submitClues, { iconIds: hand.slice(0, 2) });
    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: hand.slice(3, 5) });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain('déjà validés');
  });

  it('refuse une soumission arrivée après la phase', async () => {
    const { players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;
    const hand = handOf(host);

    await host.waitForView((v) => v.phase === 'GUESSING', 'devinette', 8_000);

    const response = await host.emit(CLIENT_EVENTS.submitClues, { iconIds: hand.slice(0, 2) });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TOO_LATE');
      expect(response.error.message).toContain('Trop tard');
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation automatique en fin de minuteur', () => {
  it('tire une icône au sort pour un joueur qui n’a rien envoyé', async () => {
    const { code, players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;

    await host.waitForView((v) => v.phase === 'GUESSING', 'devinette', 8_000);

    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    for (const assignment of round.assignments.values()) {
      expect(assignment.cluesSubmitted).toBe(true);
      expect(assignment.selectedIcons).toHaveLength(1);
      // L'icône tirée appartient bien à la main du joueur.
      expect(assignment.hand).toContain(assignment.selectedIcons[0]);
    }
  });

  it('conserve la sélection de ceux qui avaient validé', async () => {
    const { code, players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;
    const chosen = handOf(host).slice(0, 3);

    await host.emit(CLIENT_EVENTS.submitClues, { iconIds: chosen });
    await host.waitForView((v) => v.phase === 'GUESSING', 'devinette', 8_000);

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.selectedIcons).toEqual(chosen);
  });

  it('donne à chaque joueur N−1 séries non vides à deviner', async () => {
    const { players } = await startedGame({ clueSeconds: 30 });

    for (const client of players) {
      const view: PlayerView = await client.waitForView(
        (v) => v.phase === 'GUESSING',
        'devinette',
        8_000,
      );

      expect(view.clueSets).toHaveLength(2);
      for (const clueSet of view.clueSets ?? []) {
        expect(clueSet.iconIds.length).toBeGreaterThan(0);
      }
      expect(view.identityChoices).toHaveLength(2);
      expect(view.identityChoices).not.toContain(view.yourIdentityId);
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('déconnexion pendant la sélection', () => {
  it('ne bloque pas la phase quand le dernier joueur attendu se déconnecte', async () => {
    // Quatre joueurs : après le départ de Zoé il en reste trois connectés, donc
    // la partie n'est pas mise en pause et on teste bien le déblocage de phase.
    const { players } = await startedGame({ playerCount: 4 });
    const [host, allan, malo, zoe] = players as [
      TestClient,
      TestClient,
      TestClient,
      TestClient,
    ];

    for (const client of [host, allan, malo]) {
      await client.emit(CLIENT_EVENTS.submitClues, { iconIds: handOf(client).slice(0, 2) });
    }

    // Zoé n'a rien envoyé, et elle part : on ne l'attend plus.
    zoe.disconnect();

    const view = await host.waitForView((v) => v.phase === 'GUESSING', 'devinette', 4_000);
    expect(view.clueSets).toHaveLength(3);
  });

  it('restaure une sélection déjà validée après reconnexion', async () => {
    const { players } = await startedGame();
    const allan = players[1]!;
    const session = allan.session!;
    const chosen = handOf(allan).slice(0, 2);

    await allan.emit(CLIENT_EVENTS.submitClues, { iconIds: chosen });
    allan.disconnect();

    const revenant = await connect();
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: session.sessionToken });

    const view = await revenant.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourCluesSubmitted === true,
      'sélection restaurée',
    );
    expect(view.yourSelectedIcons).toEqual(chosen);
  });
});
