import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  CLIENT_EVENTS,
  MAX_PICTOS,
  STARTING_HAND_CARDS,
  type PictoCard,
  type PictoZone,
  type PlacedPicto,
  type PlayerView,
} from '@identite-secrete/shared';
import { TestClient, containsValue, startTestServer, type TestHost } from './helpers';

/**
 * Remplissage du boîtier : cartes Picto, faces, zones.
 *
 * Les parties sont lancées avec des minuteurs longs (90 s, ramenés à 900 ms par
 * `TEST_TIME_SCALE`) : on veut tester les soumissions **pendant** la phase, pas
 * la course avec son échéance — qui a son propre test.
 */

let server: TestHost;
let clients: TestClient[] = [];

async function connect(): Promise<TestClient> {
  const client = TestClient.connect(server);
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
      'remplissage du boîtier',
      8_000,
    );
  }

  return { code, players };
}

/** La main d'un joueur, telle qu'il l'a reçue. */
function handOf(client: TestClient): PictoCard[] {
  const hand = client.lastView.yourHand;
  if (!hand) throw new Error('main non reçue');
  return hand;
}

/** Les deux faces de toutes les cartes d'une main. */
function facesOf(client: TestClient): string[] {
  return handOf(client).flatMap((card) => [card.front, card.back]);
}

/** Un boîtier valide construit depuis les premières cartes de la main. */
function place(cards: PictoCard[], count: number, zone: PictoZone = 'green'): PlacedPicto[] {
  return cards.slice(0, count).map((card) => ({ cardId: card.id, iconId: card.front, zone }));
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

describe('distribution des cartes Picto', () => {
  it('donne 10 cartes de deux pictogrammes distincts à chaque joueur', async () => {
    const { players } = await startedGame();

    for (const client of players) {
      const hand = handOf(client);
      expect(hand).toHaveLength(STARTING_HAND_CARDS);

      for (const card of hand) {
        expect(card.front).not.toBe(card.back);
      }

      // Les identifiants de cartes sont uniques dans la main.
      expect(new Set(hand.map((card) => card.id)).size).toBe(STARTING_HAND_CARDS);
      // Et aucun pictogramme n'apparaît deux fois, même sur deux cartes.
      expect(new Set(facesOf(client)).size).toBe(STARTING_HAND_CARDS * 2);
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('soumission valide', () => {
  it('enregistre le boîtier et le renvoie au joueur', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const chosen = place(handOf(host), 3);

    const response = await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    expect(response.ok).toBe(true);

    const view = await host.waitForView((v) => v.yourCluesSubmitted === true, 'boîtier validé');
    expect(view.yourPlaced).toEqual(chosen);
  });

  it('accepte de mélanger zone verte et zone rouge', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const hand = handOf(host);

    const chosen: PlacedPicto[] = [
      { cardId: hand[0]!.id, iconId: hand[0]!.front, zone: 'green' },
      { cardId: hand[1]!.id, iconId: hand[1]!.back, zone: 'red' },
    ];

    const response = await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    expect(response.ok).toBe(true);

    const view = await host.waitForView((v) => v.yourCluesSubmitted === true, 'boîtier validé');
    expect(view.yourPlaced).toEqual(chosen);
  });

  it('affiche la progression aux autres, sans révéler les pictogrammes', async () => {
    const { players } = await startedGame();
    const [host, allan] = players as [TestClient, TestClient];

    // Les mains de deux joueurs peuvent se recouper — c'est voulu, c'est même ce
    // qui crée l'ambiguïté du jeu. On écarte donc les pictogrammes qu'Allan a
    // lui aussi : les recevoir est légitime, et les compter comme une fuite
    // ferait échouer ce test au hasard du tirage.
    const allanFaces = new Set(facesOf(allan));
    const usable = handOf(host).filter(
      (card) => !allanFaces.has(card.front) && !allanFaces.has(card.back),
    );
    expect(usable.length, 'au moins deux cartes inconnues d’Allan').toBeGreaterThanOrEqual(2);

    const chosen = place(usable, 2);
    await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });

    const view = await allan.waitForView(
      (v) => v.progress?.some((entry) => entry.submitted) === true,
      'progression de Sarah',
    );

    const sarah = view.progress?.find((entry) => entry.nickname === 'Sarah');
    expect(sarah?.submitted).toBe(true);
    expect(view.progress?.find((entry) => entry.nickname === 'Allan')?.submitted).toBe(false);

    // Les pictogrammes de Sarah ne doivent apparaître dans aucun payload d'Allan.
    for (const picto of chosen) {
      for (const payload of allan.allPayloads) {
        expect(containsValue(payload, picto.iconId), `fuite de ${picto.iconId}`).toBe(false);
      }
    }
  });

  it('accepte un boîtier d’un seul pictogramme', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: place(handOf(host), 1),
    });
    expect(response.ok).toBe(true);
  });

  it('conclut la phase dès que tout le monde a validé', async () => {
    const { players } = await startedGame();

    for (const client of players) {
      await client.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(client), 2) });
    }

    // La phase suivante arrive sans attendre les 900 ms du minuteur.
    const view = await players[0]!.waitForView(
      (v) => v.phase === 'GUESSING',
      'phase de vote',
      2_000,
    );
    expect(view.opponents).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────

describe('la main s’épuise', () => {
  it('défausse les cartes jouées et ne les remplace jamais', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;
    const played = place(handOf(host), 2);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: played });
    await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 4_000);

    const game = await server.store.get(code);
    const hand = game!.players.get(host.session!.playerId)!.hand;

    expect(hand).toHaveLength(STARTING_HAND_CARDS - 2);
    for (const picto of played) {
      expect(hand.some((card) => card.id === picto.cardId)).toBe(false);
    }
  });

  it('refuse une carte déjà défaussée à la manche suivante', async () => {
    const { players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;
    const played = place(handOf(host), 2);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: played });

    // On attend la manche 2, où la main est plus courte.
    await host.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.roundNumber === 2,
      'manche 2',
      20_000,
    );

    expect(handOf(host)).toHaveLength(STARTING_HAND_CARDS - 2);

    const response = await host.emit(CLIENT_EVENTS.submitClues, { placed: played });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('CARD_NOT_IN_HAND');
  });

  it('publie le nombre de cartes restantes de chacun, jamais leur contenu', async () => {
    const { players } = await startedGame();
    const [host, allan] = players as [TestClient, TestClient];

    // Relevée maintenant : la main n'est plus envoyée une fois la phase passée.
    const hostHand = handOf(host);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: place(hostHand, 2) });
    const view = await allan.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 4_000);

    const sarah = view.players.find((player) => player.nickname === 'Sarah');
    expect(sarah?.cardsLeft).toBe(STARTING_HAND_CARDS - 2);

    // Allan ne reçoit jamais les cartes de Sarah, seulement leur nombre.
    const hostHandIds = hostHand.map((card) => card.id);
    for (const cardId of hostHandIds) {
      for (const payload of allan.allPayloads) {
        expect(containsValue(payload, cardId), `fuite de ${cardId}`).toBe(false);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation anti-triche', () => {
  it('refuse une carte absente de la main', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: 'carte-inventee', iconId: handOf(host)[0]!.front, zone: 'green' }],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('CARD_NOT_IN_HAND');
  });

  it('refuse la carte d’un autre joueur', async () => {
    const { players } = await startedGame();
    const [host, allan] = players as [TestClient, TestClient];
    const foreign = handOf(allan)[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: foreign.id, iconId: foreign.front, zone: 'green' }],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('CARD_NOT_IN_HAND');
  });

  it('refuse un pictogramme qui n’est pas sur la carte annoncée', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const hand = handOf(host);

    // La face d'une autre carte de sa propre main : elle lui appartient, mais
    // une carte ne peut montrer que l'un de ses deux pictogrammes.
    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: hand[0]!.id, iconId: hand[1]!.front, zone: 'green' }],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INVALID_PAYLOAD');
      expect(response.error.message).toContain('pas sur cette carte');
    }
  });

  it('refuse plus de pictogrammes que la règle', async () => {
    const { players } = await startedGame();
    const host = players[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: place(handOf(host), MAX_PICTOS + 1),
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('TOO_MANY_CLUES');
  });

  it('refuse un boîtier vide', async () => {
    const { players } = await startedGame();
    const response = await players[0]!.emit(CLIENT_EVENTS.submitClues, { placed: [] });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('refuse de poser deux fois la même carte', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const card = handOf(host)[0]!;

    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [
        { cardId: card.id, iconId: card.front, zone: 'green' },
        { cardId: card.id, iconId: card.back, zone: 'red' },
      ],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('refuse une zone inconnue', async () => {
    const { players } = await startedGame();
    const card = handOf(players[0]!)[0]!;

    const response = await players[0]!.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: card.id, iconId: card.front, zone: 'bleu' }],
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('INVALID_PAYLOAD');
  });

  it('n’écrit rien quand la validation échoue', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;

    await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: 'carte-inventee', iconId: 'icone-inventee', zone: 'green' }],
    });

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.placed).toEqual([]);
    expect(assignment.cluesSubmitted).toBe(false);
    // Et la main est intacte.
    expect(game!.players.get(host.session!.playerId)!.hand).toHaveLength(STARTING_HAND_CARDS);
  });
});

// ─────────────────────────────────────────────────────────────

describe('idempotence', () => {
  it('accepte deux fois la même soumission sans effet de bord', async () => {
    const { code, players } = await startedGame();
    const host = players[0]!;
    const chosen = place(handOf(host), 2);

    const first = await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    const second = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: [...chosen].reverse(),
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.placed).toEqual(chosen);
  });

  it('refuse de changer d’avis après validation', async () => {
    const { players } = await startedGame();
    const host = players[0]!;
    const hand = handOf(host);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: place(hand, 2) });
    const response = await host.emit(CLIENT_EVENTS.submitClues, {
      placed: place(hand.slice(3), 2),
    });

    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.message).toContain('déjà validé');
  });

  it('refuse une soumission arrivée après la phase', async () => {
    const { players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;
    const hand = handOf(host);

    await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 8_000);

    const response = await host.emit(CLIENT_EVENTS.submitClues, { placed: place(hand, 2) });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('TOO_LATE');
      expect(response.error.message).toContain('Trop tard');
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('validation automatique en fin de minuteur', () => {
  it('tire une carte au sort pour un joueur qui n’a rien posé', async () => {
    const { code, players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;

    const before = new Map(
      players.map((client) => [client.session!.playerId, handOf(client)]),
    );

    await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 8_000);

    const game = await server.store.get(code);
    const round = game!.rounds[0]!;

    for (const [playerId, assignment] of round.assignments) {
      expect(assignment.cluesSubmitted).toBe(true);
      expect(assignment.placed).toHaveLength(1);

      // La carte tirée appartenait bien à la main du joueur, et la face montrée
      // est bien l'une des deux siennes.
      const picto = assignment.placed[0]!;
      const card = before.get(playerId)!.find((candidate) => candidate.id === picto.cardId);
      expect(card, 'carte issue de sa propre main').toBeDefined();
      expect([card!.front, card!.back]).toContain(picto.iconId);
    }
  });

  it('conserve le boîtier de ceux qui avaient validé', async () => {
    const { code, players } = await startedGame({ clueSeconds: 30 });
    const host = players[0]!;
    const chosen = place(handOf(host), 3);

    await host.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 8_000);

    const game = await server.store.get(code);
    const assignment = game!.rounds[0]!.assignments.get(host.session!.playerId)!;
    expect(assignment.placed).toEqual(chosen);
  });

  it('donne à chaque joueur N−1 boîtiers non vides et les 8 numéros', async () => {
    const { players } = await startedGame({ clueSeconds: 30 });

    for (const client of players) {
      const view: PlayerView = await client.waitForView(
        (v) => v.phase === 'GUESSING',
        'phase de vote',
        8_000,
      );

      expect(view.opponents).toHaveLength(2);
      for (const opponent of view.opponents ?? []) {
        expect(opponent.placed.length).toBeGreaterThan(0);
        expect(opponent.nickname).toBeTruthy();
      }

      // Le plateau reste entier : c'est là que vivent les leurres.
      expect(view.board).toHaveLength(BOARD_SIZE);
    }
  });
});

// ─────────────────────────────────────────────────────────────

describe('exclusion en cours de manche', () => {
  it('ne fait plus attendre le joueur exclu', async () => {
    // Quatre joueurs : après l'exclusion de Zoé il en reste trois connectés, donc
    // la partie n'est pas mise en pause et on teste bien le déblocage de phase.
    const { players } = await startedGame({ playerCount: 4 });
    const [host, allan, malo, zoe] = players as [
      TestClient,
      TestClient,
      TestClient,
      TestClient,
    ];

    for (const client of [host, allan, malo]) {
      await client.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(client), 2) });
    }

    // Zoé n'a rien posé, et l'hôte la sort : la phase se conclut sans elle.
    const response = await host.emit(CLIENT_EVENTS.kickPlayer, {
      playerId: zoe.session!.playerId,
    });
    expect(response.ok).toBe(true);

    const view = await host.waitForView(
      (v) => v.phase === 'GUESSING',
      'phase de vote',
      4_000,
    );
    expect(view.opponents).toHaveLength(2);
    expect(view.players.map((player) => player.nickname)).not.toContain('Zoé');
  });

  it('laisse la manche se terminer et révèle le boîtier de l’exclu', async () => {
    const { players } = await startedGame({ playerCount: 4, clueSeconds: 30 });
    const [host, , , zoe] = players as [TestClient, TestClient, TestClient, TestClient];

    await host.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(host), 2) });
    await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 8_000);

    // Exclusion en pleine phase de vote : son boîtier reste dans la manche.
    await host.emit(CLIENT_EVENTS.kickPlayer, { playerId: zoe.session!.playerId });

    const results = await host.waitForView(
      (v) => v.phase === 'RESULTS',
      'révélation',
      8_000,
    );

    expect(results.reveals).toHaveLength(4);
    expect(results.reveals?.map((reveal) => reveal.nickname)).toContain('Joueur parti');
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
      await client.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(client), 2) });
    }

    // Zoé n'a rien envoyé, et elle part : on ne l'attend plus.
    zoe.disconnect();

    const view = await host.waitForView((v) => v.phase === 'GUESSING', 'phase de vote', 4_000);
    expect(view.opponents).toHaveLength(3);
  });

  it('restaure un boîtier déjà validé après reconnexion', async () => {
    const { players } = await startedGame();
    const allan = players[1]!;
    const session = allan.session!;
    const chosen = place(handOf(allan), 2);

    await allan.emit(CLIENT_EVENTS.submitClues, { placed: chosen });
    allan.disconnect();

    const revenant = await connect();
    await revenant.emit(CLIENT_EVENTS.rejoinGame, { sessionToken: session.sessionToken });

    const view = await revenant.waitForView(
      (v) => v.phase === 'CLUE_SELECTION' && v.yourCluesSubmitted === true,
      'boîtier restauré',
    );
    expect(view.yourPlaced).toEqual(chosen);
  });
});
