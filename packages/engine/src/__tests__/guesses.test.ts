import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, type PlayerView } from '@identite-secrete/shared';
import { TestClient, startTestServer, type TestHost } from './helpers';

/**
 * Devinette, scores et rejouer (Lot 4).
 *
 * Les tests connaissent la vérité — ils lisent `labelMap` directement dans le
 * store — pour pouvoir composer des réponses justes ou fausses à volonté. Les
 * **clients**, eux, ne la reçoivent jamais : c'est ce que vérifient les tests
 * de confidentialité de `phases.test.ts`.
 */

let server: TestHost;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = TestClient.connect(server);
  clients.push(client);
  return client;
}

interface Playing {
  code: string;
  players: TestClient[];
}

/**
 * Une partie amenée jusqu'à la phase de devinette, indices envoyés.
 *
 * `rounds` doit être une valeur proposée par le salon (3 / 5 / 8 / 10) : le
 * schéma Zod rejette tout le reste, et rejetterait alors **l'ensemble** du
 * payload de réglages. D'où l'assertion sur l'acquittement — sans elle, un
 * réglage refusé passerait inaperçu et le test tournerait sur autre chose que
 * ce qu'il croit.
 */
async function playingGame(rounds: 3 | 5 | 8 | 10 = 3): Promise<Playing> {
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const players = [host];

  for (const nickname of ['Allan', 'Malo']) {
    const guest = await connect();
    await guest.joinGame(code, nickname);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === 3, 'salon à 3');
  const settings = await host.emit(CLIENT_EVENTS.updateSettings, {
    clueSeconds: 90,
    guessSeconds: 90,
    rounds,
  });
  expect(settings.ok, 'réglages acceptés').toBe(true);

  await host.emit(CLIENT_EVENTS.startGame, {});

  for (const client of players) {
    await client.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
      'sélection',
      8_000,
    );
  }

  for (const client of players) {
    await client.emit(CLIENT_EVENTS.submitClues, {
      iconIds: client.lastView.yourHand!.slice(0, 2),
    });
  }

  for (const client of players) {
    await client.waitForView((v) => v.phase === 'GUESSING', 'devinette', 4_000);
  }

  return { code, players };
}

/**
 * Les réponses parfaites d'un joueur : chaque étiquette reçoit l'identité
 * réellement attribuée au joueur qui se cache derrière.
 */
async function perfectGuesses(
  code: string,
  client: TestClient,
): Promise<Record<string, string>> {
  const game = await server.store.get(code);
  const round = game!.rounds[game!.currentRound - 1]!;
  const guesses: Record<string, string> = {};

  for (const clueSet of client.lastView.clueSets ?? []) {
    const ownerId = round.labelMap[clueSet.label]!;
    guesses[clueSet.label] = round.assignments.get(ownerId)!.identityId;
  }

  return guesses;
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

describe('matériel de devinette', () => {
  it('présente N−1 séries et N−1 identités, sans les siennes', async () => {
    const { code, players } = await playingGame();
    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    for (const client of players) {
      const view: PlayerView = client.lastView;
      const ownLabel = Object.entries(round.labelMap).find(
        ([, id]) => id === client.session!.playerId,
      )![0];

      expect(view.clueSets).toHaveLength(2);
      expect(view.clueSets?.map((set) => set.label)).not.toContain(ownLabel);
      expect(view.identityChoices).toHaveLength(2);
      expect(view.identityChoices).not.toContain(view.yourIdentityId);
    }
  });

  it('trie les listes pour que l’ordre n’apprenne rien', async () => {
    const { players } = await playingGame();
    const view = players[0]!.lastView;

    const labels = view.clueSets?.map((set) => set.label) ?? [];
    expect(labels).toEqual([...labels].sort());
    expect(view.identityChoices).toEqual([...(view.identityChoices ?? [])].sort());
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation des réponses', () => {
  it('accepte un appariement complet et valide', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: await perfectGuesses(code, host),
    });
    expect(response.ok).toBe(true);

    const view = await host.waitForView((v) => v.yourGuessesSubmitted === true, 'validé');
    expect(Object.keys(view.yourGuesses ?? {})).toHaveLength(2);
  });

  it('accepte une réponse partielle', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const complete = await perfectGuesses(code, host);
    const [firstLabel] = Object.keys(complete);

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [firstLabel!]: complete[firstLabel!]! },
    });
    expect(response.ok).toBe(true);
  });

  it('refuse deux fois la même identité', async () => {
    const { players } = await playingGame();
    const host = players[0]!;
    const view = host.lastView;
    const [labelA, labelB] = view.clueSets!.map((set) => set.label);
    const identity = view.identityChoices![0]!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [labelA!]: identity, [labelB!]: identity },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INVALID_GUESS');
      expect(response.error.message).toContain('une seule fois');
    }
  });

  it('refuse de deviner sa propre série', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    const ownLabel = Object.entries(round.labelMap).find(
      ([, id]) => id === host.session!.playerId,
    )![0];

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [ownLabel]: host.lastView.identityChoices![0]! },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_GUESS');
  });

  it('refuse de proposer sa propre identité', async () => {
    const { players } = await playingGame();
    const host = players[0]!;
    const label = host.lastView.clueSets![0]!.label;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [label]: host.lastView.yourIdentityId! },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_GUESS');
  });

  it('refuse une identité qui n’est pas en jeu', async () => {
    const { players } = await playingGame();
    const host = players[0]!;
    const label = host.lastView.clueSets![0]!.label;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [label]: 'identite-inventee' },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_GUESS');
  });

  it('n’écrit rien quand la validation échoue', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    await host.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: { [host.lastView.clueSets![0]!.label]: 'identite-inventee' },
    });

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.guesses).toEqual({});
    expect(assignment.guessesSubmitted).toBe(false);
  });

  it('est idempotent, et refuse de changer d’avis', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const guesses = await perfectGuesses(code, host);

    expect((await host.emit(CLIENT_EVENTS.submitGuesses, { guesses })).ok).toBe(true);
    expect((await host.emit(CLIENT_EVENTS.submitGuesses, { guesses })).ok).toBe(true);

    const labels = Object.keys(guesses);
    const swapped = {
      [labels[0]!]: guesses[labels[1]!]!,
      [labels[1]!]: guesses[labels[0]!]!,
    };
    const changed = await host.emit(CLIENT_EVENTS.submitGuesses, { guesses: swapped });

    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.message).toContain('déjà validées');
  });
});

// ─────────────────────────────────────────────────────────────

describe('scores', () => {
  it('donne le maximum quand tout le monde trouve tout', async () => {
    const { code, players } = await playingGame();

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }

    const view = await players[0]!.waitForView(
      (v) => v.phase === 'RESULTS',
      'révélation',
      4_000,
    );

    // 3 joueurs : +2 pour faire deviner, +2 pour deviner.
    for (const line of view.roundScores ?? []) {
      expect(line.given).toBe(2);
      expect(line.guessed).toBe(2);
      expect(line.total).toBe(4);
      expect(line.cumulative).toBe(4);
    }

    for (const reveal of view.reveals ?? []) {
      expect(reveal.guessedByPlayerIds).toHaveLength(2);
      expect(reveal.possibleGuessers).toBe(2);
    }
  });

  it('laisse tout le monde à zéro quand personne ne répond', async () => {
    const { players } = await playingGame();

    const view = await players[0]!.waitForView(
      (v) => v.phase === 'RESULTS',
      'révélation',
      8_000,
    );

    for (const line of view.roundScores ?? []) {
      expect(line.total).toBe(0);
    }
  });

  it('compte correctement une réponse juste et une fausse', async () => {
    const { code, players } = await playingGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];

    // Sarah répond juste ; Allan inverse ses deux réponses ; Malo ne répond pas.
    const correct = await perfectGuesses(code, host);
    await host.emit(CLIENT_EVENTS.submitGuesses, { guesses: correct });

    const allanCorrect = await perfectGuesses(code, allan);
    const allanLabels = Object.keys(allanCorrect);
    await allan.emit(CLIENT_EVENTS.submitGuesses, {
      guesses: {
        [allanLabels[0]!]: allanCorrect[allanLabels[1]!]!,
        [allanLabels[1]!]: allanCorrect[allanLabels[0]!]!,
      },
    });

    const view = await malo.waitForView((v) => v.phase === 'RESULTS', 'révélation', 8_000);

    const sarah = view.roundScores?.find((line) => line.nickname === 'Sarah');
    const allanLine = view.roundScores?.find((line) => line.nickname === 'Allan');

    // Sarah a trouvé les deux autres : +2 en devinette.
    expect(sarah?.guessed).toBe(2);
    // Allan s'est trompé deux fois.
    expect(allanLine?.guessed).toBe(0);
    // Allan a été trouvé par Sarah seulement : +1 en « faire deviner ».
    expect(allanLine?.given).toBe(1);
  });

  it('cumule les scores d’une manche à l’autre', async () => {
    const { code, players } = await playingGame(3);
    const host = players[0]!;

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }

    await host.waitForView((v) => v.phase === 'SCOREBOARD', 'classement', 8_000);
    await host.emit(CLIENT_EVENTS.nextRound, {});

    for (const client of players) {
      await client.waitForView(
        (v) => v.roundNumber === 2 && v.phase === 'CLUE_SELECTION',
        'manche 2',
        8_000,
      );
      await client.emit(CLIENT_EVENTS.submitClues, {
        iconIds: client.lastView.yourHand!.slice(0, 2),
      });
    }

    for (const client of players) {
      await client.waitForView((v) => v.phase === 'GUESSING', 'devinette 2', 4_000);
    }
    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }

    // La 3ᵉ manche se joue toute seule, sans réponse : elle n'ajoute aucun point.
    const final = await host.waitForView(
      (v) => v.phase === 'FINAL_RESULTS',
      'fin de partie',
      15_000,
    );

    expect(final.standings?.every((line) => line.cumulative === 8)).toBe(true);
    expect(final.stats?.bestDetective?.correctGuesses).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────

describe('rejouer', () => {
  it('remet les scores à zéro et revient au salon', async () => {
    const { code, players } = await playingGame(3);
    const host = players[0]!;

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }

    await host.waitForView((v) => v.phase === 'FINAL_RESULTS', 'fin de partie', 15_000);

    const before = await server.store.get(code);
    const usedBefore = new Set(before!.usedIdentityIds);
    // 3 manches × 3 joueurs, sans jamais réutiliser une identité.
    expect(usedBefore.size).toBe(9);

    const response = await host.emit(CLIENT_EVENTS.replay, {});
    expect(response.ok).toBe(true);

    const lobby = await host.waitForView((v) => v.phase === 'LOBBY', 'retour au salon');
    expect(lobby.players.every((player) => player.score === 0)).toBe(true);
    expect(lobby.roundNumber).toBe(0);

    // Les identités déjà jouées restent mémorisées pour ne pas les redonner.
    const after = await server.store.get(code);
    expect(after!.usedIdentityIds).toEqual(usedBefore);
  });

  it('refuse rejouer hors de la fin de partie et par un non-hôte', async () => {
    const { code, players } = await playingGame(3);
    const [host, allan] = players as [TestClient, TestClient];

    const tooEarly = await host.emit(CLIENT_EVENTS.replay, {});
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.error.code).toBe('WRONG_PHASE');

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }
    await host.waitForView((v) => v.phase === 'FINAL_RESULTS', 'fin de partie', 15_000);

    const notHost = await allan.emit(CLIENT_EVENTS.replay, {});
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe('NOT_HOST');
  });

  it('permet de relancer une partie complète après rejouer', async () => {
    const { code, players } = await playingGame(3);
    const host = players[0]!;

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        guesses: await perfectGuesses(code, client),
      });
    }
    await host.waitForView((v) => v.phase === 'FINAL_RESULTS', 'fin de partie', 15_000);
    await host.emit(CLIENT_EVENTS.replay, {});
    await host.waitForView((v) => v.phase === 'LOBBY', 'salon');

    // Les réglages sont de nouveau modifiables, et la partie repart.
    expect((await host.emit(CLIENT_EVENTS.updateSettings, { rounds: 3 })).ok).toBe(true);
    expect((await host.emit(CLIENT_EVENTS.startGame, {})).ok).toBe(true);

    const view = await host.waitForView((v) => v.roundNumber === 1, 'manche 1');
    expect(view.you.score).toBe(0);
  });
});
