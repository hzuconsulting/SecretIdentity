import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  IDENTITY_REVEAL_MS,
  SERVER_EVENTS,
  type PhaseChangedPayload,
  type PlayerView,
} from '@identite-secrete/shared';
import type { GameServer } from '../server';
import { TestClient, containsValue, startTestServer } from './helpers';

/**
 * Tests de la machine à états.
 *
 * Le serveur de test applique `TEST_TIME_SCALE` (0,01) à toutes les durées de
 * phase : une phase réglée sur 60 s dure 600 ms. Les minuteurs restent de vrais
 * `setTimeout`, et l'enchaînement testé est exactement celui de production.
 */

let server: GameServer;
let url: string;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(url);
  clients.push(client);
  return client;
}

/**
 * Une partie lancée.
 *
 * `slow` allonge les deux phases de saisie (90 s → 900 ms) : nécessaire pour
 * les tests de confidentialité, qui doivent avoir le temps d'inspecter les
 * payloads pendant `CLUE_SELECTION`.
 */
async function startedGame(
  playerCount = 3,
  options: { slow?: boolean; rounds?: number } = {},
): Promise<{ code: string; players: TestClient[] }> {
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const players = [host];

  const names = ['Allan', 'Malo', 'Zoé', 'Nils', 'Iris', 'Théo', 'Lou'];
  for (let i = 1; i < playerCount; i++) {
    const guest = await connect();
    await guest.joinGame(code, names[i - 1] ?? `J${i}`);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === playerCount, 'salon complet');

  if (options.slow) {
    await host.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: 90, guessSeconds: 90 });
  }
  if (options.rounds) {
    await host.emit(CLIENT_EVENTS.updateSettings, { rounds: options.rounds });
  }

  const response = await host.emit(CLIENT_EVENTS.startGame, {});
  expect(response.ok).toBe(true);

  return { code, players };
}

/** Écoute les annonces `phase:changed` d'un client. */
function collectPhases(client: TestClient): PhaseChangedPayload[] {
  const seen: PhaseChangedPayload[] = [];
  client.socket.on(SERVER_EVENTS.phaseChanged, (payload: PhaseChangedPayload) => {
    seen.push(payload);
  });
  return seen;
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

describe('lancement de la partie', () => {
  it('refuse le lancement sous 3 joueurs', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const response = await host.emit(CLIENT_EVENTS.startGame, {});

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('refuse le lancement par un non-hôte', async () => {
    const { players } = await startedGameLobby();
    const response = await players[1]!.emit(CLIENT_EVENTS.startGame, {});

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('NOT_HOST');
  });

  it('passe en IDENTITY_REVEAL et verrouille les réglages', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    await host.waitForView((v) => v.phase === 'IDENTITY_REVEAL', 'révélation');

    const response = await host.emit(CLIENT_EVENTS.updateSettings, { rounds: 10 });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('WRONG_PHASE');
  });

  it('est idempotent sur un double lancement', async () => {
    const { players } = await startedGame();
    const second = await players[0]!.emit(CLIENT_EVENTS.startGame, {});

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('WRONG_PHASE');
  });
});

// ─────────────────────────────────────────────────────────────

describe('attribution de la manche', () => {
  it('donne à chaque joueur une identité distincte', async () => {
    const { code, players } = await startedGame(4);

    for (const client of players) {
      await client.waitForView((v) => v.yourIdentityId !== undefined, 'identité reçue');
    }

    const identities = players.map((client) => client.lastView.yourIdentityId);
    expect(new Set(identities).size).toBe(4);
    expect(identities.every((id) => typeof id === 'string')).toBe(true);

    const game = await server.store.get(code);
    expect(game?.usedIdentityIds.size).toBe(4);
  });

  it('donne à chaque joueur une main de la bonne taille', async () => {
    const { code, players } = await startedGame();
    const game = await server.store.get(code);
    const round = game?.rounds[0];

    expect(round?.assignments.size).toBe(3);
    for (const assignment of round?.assignments.values() ?? []) {
      expect(assignment.hand).toHaveLength(game!.settings.handSize);
      expect(new Set(assignment.hand).size).toBe(assignment.hand.length);
    }
    expect(players).toHaveLength(3);
  });

  it('attribue une étiquette distincte à chaque joueur', async () => {
    const { code } = await startedGame(4);
    const game = await server.store.get(code);
    const labelMap = game?.rounds[0]?.labelMap ?? {};

    expect(Object.keys(labelMap).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(new Set(Object.values(labelMap)).size).toBe(4);
  });

  it('ne réutilise pas une identité d’une manche à l’autre', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;

    const firstIdentities = new Set<string>();
    for (const client of players) {
      const view = await client.waitForView((v) => v.yourIdentityId !== undefined, 'identité');
      firstIdentities.add(view.yourIdentityId!);
    }

    await runToScoreboard(host);
    await host.emit(CLIENT_EVENTS.nextRound, {});

    const secondIdentities = new Set<string>();
    for (const client of players) {
      const view = await client.waitForView(
        (v) => v.roundNumber === 2 && v.yourIdentityId !== undefined,
        'identité manche 2',
      );
      secondIdentities.add(view.yourIdentityId!);
    }

    const game = await server.store.get(code);
    expect(game?.currentRound).toBe(2);
    for (const identityId of secondIdentities) {
      expect(firstIdentities.has(identityId)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('transitions et échéances', () => {
  it('enchaîne automatiquement IDENTITY_REVEAL → CLUE_SELECTION', async () => {
    const { players } = await startedGameLobby();
    const host = players[0]!;

    // L'écoute est branchée AVANT le lancement : sinon la première annonce est
    // déjà passée quand on s'abonne.
    const phases = collectPhases(host);
    await host.emit(CLIENT_EVENTS.startGame, {});

    await host.waitForView((v) => v.phase === 'CLUE_SELECTION', 'sélection des indices', 8_000);

    expect(phases.map((p) => p.phase)).toEqual(['IDENTITY_REVEAL', 'CLUE_SELECTION']);
    expect(phases.every((p) => p.roundNumber === 1)).toBe(true);
    expect(phases.every((p) => p.phaseEndsAt !== null)).toBe(true);
  });

  it('annonce une échéance cohérente avec l’horloge serveur', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const view = await host.waitForView(
      (v) => v.phase === 'IDENTITY_REVEAL' && v.phaseEndsAt !== null,
      'échéance annoncée',
    );

    const remaining = view.phaseEndsAt! - view.serverTime;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(IDENTITY_REVEAL_MS);
  });

  it('donne la même échéance à tous les joueurs', async () => {
    const { players } = await startedGame();

    const views: PlayerView[] = [];
    for (const client of players) {
      views.push(
        await client.waitForView(
          (v) => v.phase === 'CLUE_SELECTION' && v.phaseEndsAt !== null,
          'sélection',
          8_000,
        ),
      );
    }

    const deadlines = new Set(views.map((view) => view.phaseEndsAt));
    expect(deadlines.size).toBe(1);
  });

  it('n’attribue aucune échéance au salon ni à la fin de partie', async () => {
    const host = await connect();
    await host.createGame('Sarah');
    const view = await host.waitForView((v) => v.phase === 'LOBBY', 'salon');
    expect(view.phaseEndsAt).toBeNull();
  });

  it('permet à l’hôte d’enchaîner depuis le classement', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    await runToScoreboard(host);
    const response = await host.emit(CLIENT_EVENTS.nextRound, {});
    expect(response.ok).toBe(true);

    await host.waitForView((v) => v.roundNumber === 2, 'manche 2');
  });

  it('refuse `round:next` hors du classement et par un non-hôte', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const guest = players[1]!;

    const tooEarly = await host.emit(CLIENT_EVENTS.nextRound, {});
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.error.code).toBe('WRONG_PHASE');

    await runToScoreboard(host);

    const notHost = await guest.emit(CLIENT_EVENTS.nextRound, {});
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe('NOT_HOST');
  });

  it('termine la partie après le nombre de manches réglé', async () => {
    const { players } = await startedGame(3, { rounds: 3 });
    const host = players[0]!;

    for (let round = 1; round <= 3; round++) {
      await host.waitForView((v) => v.roundNumber === round, `manche ${round}`, 10_000);
      await runToScoreboard(host);
      await host.emit(CLIENT_EVENTS.nextRound, {});
    }

    const final = await host.waitForView(
      (v) => v.phase === 'FINAL_RESULTS',
      'fin de partie',
      15_000,
    );

    expect(final.standings).toBeDefined();
    expect(final.stats).toBeDefined();
    expect(final.phaseEndsAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────

describe('confidentialité en cours de manche', () => {
  it('ne révèle à un joueur que sa propre identité', async () => {
    const { code, players } = await startedGame(3, { slow: true });

    // On attend que tout le monde soit en sélection d'indices, puis on fige ce
    // qui a été reçu jusque-là : après RESULTS, tout est révélé légitimement.
    for (const client of players) {
      await client.waitForView((v) => v.phase === 'CLUE_SELECTION', 'sélection', 8_000);
    }
    const snapshots = players.map((client) => ({
      own: client.lastView.yourIdentityId,
      payloads: client.allPayloads.slice(),
    }));

    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    for (const snapshot of snapshots) {
      for (const assignment of round.assignments.values()) {
        if (assignment.identityId === snapshot.own) continue;

        for (const payload of snapshot.payloads) {
          expect(
            containsValue(payload, assignment.identityId),
            `fuite de ${assignment.identityId}`,
          ).toBe(false);
        }
      }
    }
  });

  it('ne révèle jamais la correspondance étiquette → joueur avant RESULTS', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    await runToScoreboard(host);

    for (const client of players) {
      expect(JSON.stringify(client.allPayloads)).not.toContain('labelMap');

      for (const view of client.received) {
        // Les séries anonymes n'existent qu'en phase de devinette, et elles
        // ne portent qu'une étiquette — jamais l'identifiant du joueur.
        if (view.phase !== 'GUESSING') {
          expect(view.clueSets, `clueSets en phase ${view.phase}`).toBeUndefined();
          continue;
        }
        for (const clueSet of view.clueSets ?? []) {
          expect(Object.keys(clueSet).sort()).toEqual(['iconIds', 'label']);
        }
      }
    }
  });

  it('n’envoie pas la main d’un joueur à un autre', async () => {
    const { code, players } = await startedGame(3, { slow: true });
    await players[0]!.waitForView((v) => v.yourHand !== undefined, 'main reçue', 8_000);

    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    const hostId = players[0]!.session!.playerId;
    const hostHand = new Set(round.assignments.get(hostId)!.hand);
    const hostView = players[0]!.lastView;

    expect(new Set(hostView.yourHand)).toEqual(hostHand);

    // Les autres joueurs reçoivent leur propre main, pas celle de l'hôte.
    for (const client of players.slice(1)) {
      const view = await client.waitForView(
        (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
        'sélection',
        8_000,
      );
      const ownHand = new Set(round.assignments.get(client.session!.playerId)!.hand);
      expect(new Set(view.yourHand)).toEqual(ownHand);
      expect(view.progress?.every((entry) => entry.submitted === false)).toBe(true);
    }
  });

  it('n’envoie que des booléens dans la progression', async () => {
    const { players } = await startedGame(3, { slow: true });
    const view = await players[0]!.waitForView(
      (v) => v.progress !== undefined,
      'progression',
      8_000,
    );

    for (const entry of view.progress ?? []) {
      expect(Object.keys(entry).sort()).toEqual(['nickname', 'playerId', 'submitted']);
      expect(typeof entry.submitted).toBe('boolean');
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('reconnexion en cours de manche', () => {
  it('restaure la phase exacte, l’identité et la main', async () => {
    const { players } = await startedGame(3, { slow: true });
    const guest = players[1]!;
    const session = guest.session!;

    const before = await guest.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
      'sélection',
      8_000,
    );

    guest.disconnect();

    const revenant = await connect();
    const response = await revenant.emit(CLIENT_EVENTS.rejoinGame, {
      sessionToken: session.sessionToken,
    });
    expect(response.ok).toBe(true);

    const after = await revenant.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
      'sélection restaurée',
    );

    expect(after.yourIdentityId).toBe(before.yourIdentityId);
    expect(after.yourHand).toEqual(before.yourHand);
    expect(after.roundNumber).toBe(before.roundNumber);
    expect(after.phaseEndsAt).toBe(before.phaseEndsAt);
  });
});

// ─────────────────────────────────────────────────────────────
//  Utilitaires locaux
// ─────────────────────────────────────────────────────────────

/** Un salon prêt à être lancé, mais pas encore lancé. */
async function startedGameLobby(): Promise<{ code: string; players: TestClient[] }> {
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const second = await connect();
  await second.joinGame(code, 'Allan');
  const third = await connect();
  await third.joinGame(code, 'Malo');

  await host.waitForView((v) => v.players.length === 3, 'salon à 3');
  return { code, players: [host, second, third] };
}

/**
 * Attend le classement.
 *
 * Personne ne soumet — `clues:submit` arrive au Lot 3 — donc la manche se
 * déroule uniquement sur ses échéances serveur. C'est précisément ce qu'on
 * veut vérifier ici.
 */
async function runToScoreboard(host: TestClient): Promise<void> {
  await host.waitForView((v: PlayerView) => v.phase === 'SCOREBOARD', 'classement', 15_000);
}
