import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  STARTING_HAND_CARDS,
  TOTAL_ROUNDS,
  type PlayerId,
  type PlayerView,
  type Slot,
} from '@identite-secrete/shared';
import { TestClient, startTestServer, type TestHost } from './helpers';

/**
 * Vote, scores et rejouer.
 *
 * Les tests connaissent la vérité — ils lisent les numéros directement dans le
 * store — pour pouvoir composer des votes justes ou faux à volonté. Les
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

/** Pose les deux premières cartes de sa main, en zone verte. */
async function placeTwo(client: TestClient): Promise<void> {
  const hand = client.lastView.yourHand!;
  await client.emit(CLIENT_EVENTS.submitClues, {
    placed: hand.slice(0, 2).map((card) => ({
      cardId: card.id,
      iconId: card.front,
      zone: 'green' as const,
    })),
  });
}

/** Une partie amenée jusqu'à la phase de vote, boîtiers remplis. */
async function playingGame(): Promise<Playing> {
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
  });
  expect(settings.ok, 'réglages acceptés').toBe(true);

  await host.emit(CLIENT_EVENTS.startGame, {});

  for (const client of players) {
    await client.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourHand !== undefined,
      'remplissage du boîtier',
      8_000,
    );
  }

  for (const client of players) await placeTwo(client);

  for (const client of players) {
    await client.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 4_000);
  }

  return { code, players };
}

/** Les votes parfaits d'un joueur : le vrai numéro de chaque adversaire. */
async function perfectVotes(
  code: string,
  client: TestClient,
): Promise<Record<PlayerId, Slot>> {
  const game = await server.store.get(code);
  const round = game!.rounds[game!.currentRound - 1]!;
  const votes: Record<PlayerId, Slot> = {};

  for (const opponent of client.lastView.opponents ?? []) {
    votes[opponent.playerId] = round.assignments.get(opponent.playerId)!.slot;
  }

  return votes;
}

/** Un numéro du plateau que personne ne porte — un leurre. */
async function decoySlot(code: string): Promise<Slot> {
  const game = await server.store.get(code);
  const round = game!.rounds[game!.currentRound - 1]!;
  const taken = new Set([...round.assignments.values()].map((a) => a.slot));

  for (let slot = 1; slot <= BOARD_SIZE; slot++) {
    if (!taken.has(slot)) return slot;
  }
  throw new Error('aucun leurre : le plateau est entièrement attribué');
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

describe('matériel de vote', () => {
  it('présente les adversaires nommés, sans soi-même', async () => {
    const { players } = await playingGame();

    for (const client of players) {
      const view: PlayerView = client.lastView;

      expect(view.opponents).toHaveLength(2);
      expect(view.opponents?.map((o) => o.playerId)).not.toContain(client.session!.playerId);
      for (const opponent of view.opponents ?? []) {
        expect(opponent.nickname).toBeTruthy();
        expect(opponent.placed.length).toBeGreaterThan(0);
      }
    }
  });

  it('propose les 8 numéros à 3 joueurs, leurres compris', async () => {
    const { code, players } = await playingGame();
    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    // Le plateau complet est public…
    for (const client of players) {
      expect(client.lastView.board).toHaveLength(BOARD_SIZE);
      expect(client.lastView.board).toEqual(round.board);
    }

    // …mais seuls 3 des 8 numéros correspondent à un joueur.
    const taken = new Set([...round.assignments.values()].map((a) => a.slot));
    expect(taken.size).toBe(3);
    expect(BOARD_SIZE - taken.size).toBe(5);
  });

  it('ne révèle le numéro d’aucun adversaire', async () => {
    const { code, players } = await playingGame();
    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    for (const client of players) {
      const own = round.assignments.get(client.session!.playerId)!.slot;
      expect(client.lastView.yourSlot).toBe(own);

      // La vue ne contient aucun champ qui associerait un adversaire à un numéro.
      for (const opponent of client.lastView.opponents ?? []) {
        expect(Object.keys(opponent)).toEqual(['playerId', 'nickname', 'placed']);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation des votes', () => {
  it('accepte un vote complet et valide', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: await perfectVotes(code, host),
    });
    expect(response.ok).toBe(true);

    const view = await host.waitForView((v) => v.yourVotesSubmitted === true, 'validé');
    expect(Object.keys(view.yourVotes ?? {})).toHaveLength(2);
  });

  it('accepte un vote partiel', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const complete = await perfectVotes(code, host);
    const [firstId] = Object.keys(complete);

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { [firstId!]: complete[firstId!]! },
    });
    expect(response.ok).toBe(true);
  });

  it('accepte un leurre : c’est un vote valide, simplement faux', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const opponent = host.lastView.opponents![0]!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { [opponent.playerId]: await decoySlot(code) },
    });
    expect(response.ok).toBe(true);
  });

  it('refuse deux fois le même numéro', async () => {
    const { players } = await playingGame();
    const host = players[0]!;
    const [a, b] = host.lastView.opponents!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { [a!.playerId]: 3, [b!.playerId]: 3 },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INVALID_GUESS');
      expect(response.error.message).toContain('une carte Vote par numéro');
    }
  });

  it('refuse de voter pour soi-même', async () => {
    const { players } = await playingGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { [host.session!.playerId]: 1 },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_GUESS');
  });

  it('refuse de voter pour un joueur qui n’est pas dans la partie', async () => {
    const { players } = await playingGame();

    const response = await players[0]!.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { 'joueur-invente': 1 },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_GUESS');
  });

  it('refuse un numéro hors du plateau', async () => {
    const { players } = await playingGame();
    const host = players[0]!;
    const opponent = host.lastView.opponents![0]!;

    for (const slot of [0, BOARD_SIZE + 1]) {
      const response = await host.emit(CLIENT_EVENTS.submitGuesses, {
        votes: { [opponent.playerId]: slot },
      });
      expect(response.ok, `numéro ${slot} refusé`).toBe(false);
    }
  });

  it('n’écrit rien quand la validation échoue', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    await host.emit(CLIENT_EVENTS.submitGuesses, { votes: { 'joueur-invente': 1 } });

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.votes).toEqual({});
    expect(assignment.votesSubmitted).toBe(false);
  });

  it('est idempotent, et refuse de changer d’avis', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;
    const votes = await perfectVotes(code, host);

    expect((await host.emit(CLIENT_EVENTS.submitGuesses, { votes })).ok).toBe(true);
    expect((await host.emit(CLIENT_EVENTS.submitGuesses, { votes })).ok).toBe(true);

    const ids = Object.keys(votes);
    const swapped = {
      [ids[0]!]: votes[ids[1]!]!,
      [ids[1]!]: votes[ids[0]!]!,
    };
    const changed = await host.emit(CLIENT_EVENTS.submitGuesses, { votes: swapped });

    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.message).toContain('déjà validés');
  });
});

// ─────────────────────────────────────────────────────────────

describe('scores', () => {
  it('donne le maximum quand tout le monde trouve tout', async () => {
    const { code, players } = await playingGame();

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        votes: await perfectVotes(code, client),
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
      expect(line.cardsLeft).toBe(STARTING_HAND_CARDS - 2);
    }

    for (const reveal of view.reveals ?? []) {
      expect(reveal.guessedByPlayerIds).toHaveLength(2);
      expect(reveal.possibleGuessers).toBe(2);
      expect(reveal.slot).toBeGreaterThanOrEqual(1);
      expect(reveal.slot).toBeLessThanOrEqual(BOARD_SIZE);
    }
  });

  it('ne donne aucun point pour un vote sur un leurre', async () => {
    const { code, players } = await playingGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];
    const decoy = await decoySlot(code);

    // Sarah attribue un leurre à Allan : le numéro existe, mais il n'est à
    // personne. Le vote est accepté, et ne rapporte rien.
    await host.emit(CLIENT_EVENTS.submitGuesses, {
      votes: { [allan.session!.playerId]: decoy },
    });

    const view = await malo.waitForView((v) => v.phase === 'RESULTS', 'révélation', 8_000);

    const sarah = view.roundScores?.find((line) => line.nickname === 'Sarah');
    const allanLine = view.roundScores?.find((line) => line.nickname === 'Allan');
    expect(sarah?.guessed).toBe(0);
    expect(allanLine?.given).toBe(0);
  });

  it('laisse tout le monde à zéro quand personne ne vote', async () => {
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

  it('compte correctement un vote juste et un vote faux', async () => {
    const { code, players } = await playingGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];

    // Sarah vote juste ; Allan inverse ses deux votes ; Malo ne vote pas.
    await host.emit(CLIENT_EVENTS.submitGuesses, { votes: await perfectVotes(code, host) });

    const allanCorrect = await perfectVotes(code, allan);
    const allanIds = Object.keys(allanCorrect);
    await allan.emit(CLIENT_EVENTS.submitGuesses, {
      votes: {
        [allanIds[0]!]: allanCorrect[allanIds[1]!]!,
        [allanIds[1]!]: allanCorrect[allanIds[0]!]!,
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

  it('cumule les scores sur les 4 manches', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        votes: await perfectVotes(code, client),
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
      await placeTwo(client);
    }

    for (const client of players) {
      await client.waitForView((v) => v.phase === 'GUESSING', 'vote 2', 4_000);
    }
    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitGuesses, {
        votes: await perfectVotes(code, client),
      });
    }

    // Les manches 3 et 4 se jouent toutes seules, sans vote : aucun point de plus.
    const final = await host.waitForView(
      (v) => v.phase === 'FINAL_RESULTS',
      'fin de partie',
      25_000,
    );

    expect(final.roundNumber).toBe(TOTAL_ROUNDS);
    expect(final.standings?.every((line) => line.cumulative === 8)).toBe(true);
    expect(final.stats?.bestDetective?.correctGuesses).toBe(4);
  });

  it('départage les ex æquo aux cartes restantes', async () => {
    const { players } = await playingGame();
    const [host, allan, malo] = players as [TestClient, TestClient, TestClient];

    // Personne ne vote : tout le monde finit la manche à égalité de points.
    await host.waitForView((v) => v.phase === 'SCOREBOARD', 'classement', 8_000);

    // Sarah a dépensé 2 cartes comme les autres ; on creuse l'écart à la manche
    // 2 en lui en faisant poser 3 et à Allan une seule.
    await host.emit(CLIENT_EVENTS.nextRound, {});
    for (const client of players) {
      await client.waitForView(
        (v) => v.roundNumber === 2 && v.phase === 'CLUE_SELECTION',
        'manche 2',
        8_000,
      );
    }

    const spend = async (client: TestClient, count: number) => {
      const hand = client.lastView.yourHand!;
      await client.emit(CLIENT_EVENTS.submitClues, {
        placed: hand.slice(0, count).map((card) => ({
          cardId: card.id,
          iconId: card.front,
          zone: 'green' as const,
        })),
      });
    };

    await spend(host, 3);
    await spend(allan, 1);
    await spend(malo, 2);

    // `roundNumber` est indispensable : `waitForView` accepte aussi les vues
    // déjà reçues, et retrouverait sinon la phase de vote de la manche 1.
    const view = await allan.waitForView(
      (v) => v.phase === 'GUESSING' && v.roundNumber === 2,
      'cartes défaussées',
      8_000,
    );

    const cardsOf = (nickname: string) =>
      view.players.find((player) => player.nickname === nickname)?.cardsLeft;

    expect(cardsOf('Sarah')).toBe(STARTING_HAND_CARDS - 5);
    expect(cardsOf('Allan')).toBe(STARTING_HAND_CARDS - 3);
    expect(cardsOf('Malo')).toBe(STARTING_HAND_CARDS - 4);

    // Le classement, à égalité de points, place Allan devant.
    const scoreboard = await allan.waitForView(
      (v) => v.phase === 'SCOREBOARD' && v.roundNumber === 2,
      'classement 2',
      8_000,
    );
    const order = scoreboard.standings?.map((line) => line.nickname);
    expect(order).toEqual(['Allan', 'Malo', 'Sarah']);
  });
});

// ─────────────────────────────────────────────────────────────

describe('rejouer', () => {
  /** Laisse les 4 manches se dérouler sans intervention. */
  async function playToTheEnd(host: TestClient): Promise<void> {
    await host.waitForView((v) => v.phase === 'FINAL_RESULTS', 'fin de partie', 25_000);
  }

  it('remet les scores à zéro, redistribue les mains et revient au salon', async () => {
    const { code, players } = await playingGame();
    const host = players[0]!;

    await playToTheEnd(host);

    const before = await server.store.get(code);
    const usedBefore = new Set(before!.usedIdentityIds);
    // 4 manches × 8 personnages, sans jamais réutiliser une identité.
    expect(usedBefore.size).toBe(TOTAL_ROUNDS * BOARD_SIZE);

    const response = await host.emit(CLIENT_EVENTS.replay, {});
    expect(response.ok).toBe(true);

    const lobby = await host.waitForView((v) => v.phase === 'LOBBY', 'retour au salon');
    expect(lobby.players.every((player) => player.score === 0)).toBe(true);
    expect(lobby.roundNumber).toBe(0);

    // Les identités déjà jouées restent mémorisées pour ne pas les redonner.
    const after = await server.store.get(code);
    expect(after!.usedIdentityIds).toEqual(usedBefore);

    // Nouvelle partie, mains neuves : la rareté repart de zéro.
    expect((await host.emit(CLIENT_EVENTS.startGame, {})).ok).toBe(true);
    const fresh = await host.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.roundNumber === 1,
      'manche 1',
      8_000,
    );
    expect(fresh.yourHand).toHaveLength(STARTING_HAND_CARDS);
  });

  it('refuse rejouer hors de la fin de partie et par un non-hôte', async () => {
    const { players } = await playingGame();
    const [host, allan] = players as [TestClient, TestClient];

    const tooEarly = await host.emit(CLIENT_EVENTS.replay, {});
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.error.code).toBe('WRONG_PHASE');

    await playToTheEnd(host);

    const notHost = await allan.emit(CLIENT_EVENTS.replay, {});
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe('NOT_HOST');
  });
});
