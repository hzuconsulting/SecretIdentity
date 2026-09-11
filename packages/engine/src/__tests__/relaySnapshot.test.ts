import { describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  MAX_PLAYERS,
  TOTAL_ROUNDS,
  cardIcons,
  parseRelaySnapshot,
  type Game,
  type PlayerView,
  type RelaySnapshot,
} from '@identite-secrete/shared';
import { buildRelaySnapshot, coerceRelayPhase, settledRoundCount } from '../serialization/relay';
import { TestClient, TestHost, containsValue, startTestServer } from './helpers';

/**
 * L'instantané de relais.
 *
 * C'est la seule chose de ce projet qui décrive l'état **de tout le monde** et
 * qui parte quand même sur le réseau. Tout le reste — les vues joueur — est
 * calculé pour un destinataire unique.
 *
 * Le premier test est donc celui qui compte, et les autres ne sont là que pour
 * qu'il reste vrai : **aucun secret vivant ne doit apparaître**. Ni un jeton de
 * session, qui permettrait d'usurper un joueur et de lire son numéro ; ni une
 * main de cartes ; ni le numéro attribué dans la manche en cours.
 *
 * Le jour où quelqu'un ajoutera un champ à `Player` et l'exposera par un
 * `spread` bien intentionné dans `serialization/relay.ts`, c'est ici que ça
 * doit s'arrêter.
 */

// ─────────────────────────────────────────────────────────────
//  Harnais
// ─────────────────────────────────────────────────────────────

interface Party {
  server: TestHost;
  code: string;
  clients: TestClient[];
  game: Game;
}

/** Une partie à trois joueurs, menée jusqu'à la sélection des indices. */
async function startedGame(server: TestHost): Promise<Party> {
  const host = TestClient.connect(server);
  const session = await host.createGame('Hôte');
  const code = session.code;

  const second = TestClient.connect(server);
  await second.joinGame(code, 'Bea');
  const third = TestClient.connect(server);
  await third.joinGame(code, 'Cléo');

  const clients = [host, second, third];
  const started = clients.map((client) =>
    client.waitForView((view) => view.phase === 'CLUE_SELECTION', 'sélection des indices'),
  );
  await host.emit(CLIENT_EVENTS.startGame, {});
  await Promise.all(started);

  const game = await server.store.get(code);
  if (!game) throw new Error('partie introuvable');

  return { server, code, clients, game };
}

/** Joue une manche complète et s'arrête au classement. */
async function playRound(party: Party): Promise<void> {
  const { clients } = party;

  const atGuessing = clients.map((client) =>
    client.waitForNextView((view) => view.phase === 'GUESSING', 'devinette'),
  );
  for (const client of clients) {
    const hand = client.lastView.yourHand ?? [];
    const card = hand[0];
    if (!card) throw new Error('main vide');
    await client.emit(CLIENT_EVENTS.submitClues, {
      placed: [{ cardId: card.id, iconId: card.front[0], zone: 'green' }],
    });
  }
  await Promise.all(atGuessing);

  // La manche se termine sur la révélation : il n'y a plus de minuteur pour
  // enchaîner, et `settledRoundCount` la compte déjà comme réglée.
  const atRoundEnd = clients.map((client) =>
    client.waitForNextView((view) => view.phase === 'RESULTS', 'révélation'),
  );
  for (const client of clients) {
    const view = client.lastView;
    const votes: Record<string, number> = {};
    for (const opponent of view.opponents ?? []) votes[opponent.playerId] = 1;
    await client.emit(CLIENT_EVENTS.submitGuesses, { votes });
  }
  await Promise.all(atRoundEnd);
}

function snapshotOf(game: Game): Promise<RelaySnapshot> {
  return buildRelaySnapshot(game, { epoch: 0, seq: 1 });
}

// ─────────────────────────────────────────────────────────────

describe('confidentialité de l’instantané', () => {
  it('ne laisse sortir aucun secret, manche en cours comprise', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);
      const snapshot = await snapshotOf(party.game);
      const encoded = JSON.stringify(snapshot);

      for (const player of party.game.players.values()) {
        // Le jeton : le divulguer permettrait d'usurper ce joueur, donc de lire
        // son numéro secret. C'est la fuite la plus grave possible.
        expect(containsValue(snapshot, player.sessionToken), `jeton de ${player.nickname}`).toBe(
          false,
        );

        // La main : chaque carte, et chacun de ses quatre pictogrammes.
        for (const card of player.hand) {
          expect(containsValue(snapshot, card.id), `carte de ${player.nickname}`).toBe(false);
          for (const icon of cardIcons(card)) {
            expect(containsValue(snapshot, icon), `pictogramme de ${player.nickname}`).toBe(
              false,
            );
          }
        }
      }

      // Les numéros de la manche en cours : elle n'est pas transportée du tout.
      expect(snapshot.rounds).toHaveLength(0);
      expect(snapshot.phase).toBe('LOBBY');

      // Et pour attraper un champ ajouté demain sans y penser, on refuse aussi
      // les noms eux-mêmes — c'est le garde-fou de `lobby.test.ts:409`.
      for (const secret of ['sessionToken', 'hand', 'connectionId', 'placed', 'cardId']) {
        expect(encoded.includes(secret), secret).toBe(false);
      }
    } finally {
      server.close();
    }
  });

  it('ne transporte que les manches réglées, et leurs numéros déjà révélés', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);
      await playRound(party);

      const snapshot = await snapshotOf(party.game);

      // La manche 1 est réglée : ses numéros ont été montrés à tout le monde
      // pendant la révélation, les transporter ne divulgue rien de neuf.
      expect(snapshot.rounds).toHaveLength(1);
      expect(snapshot.phase).toBe('SCOREBOARD');

      // Les mains, en revanche, restent secrètes même après la manche.
      for (const player of party.game.players.values()) {
        for (const card of player.hand) {
          expect(containsValue(snapshot, card.id), `carte de ${player.nickname}`).toBe(false);
        }
        expect(containsValue(snapshot, player.sessionToken)).toBe(false);
      }
    } finally {
      server.close();
    }
  });

  it('publie une empreinte de session, pas la session', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);
      const snapshot = await snapshotOf(party.game);

      for (const player of snapshot.players) {
        // 64 caractères hexadécimaux : une empreinte SHA-256, rien d'autre.
        expect(player.sessionHash).toMatch(/^[0-9a-f]{64}$/);
      }

      // Deux joueurs n'ont jamais la même empreinte, sinon l'un pourrait
      // reprendre la session de l'autre après une migration.
      const hashes = new Set(snapshot.players.map((player) => player.sessionHash));
      expect(hashes.size).toBe(snapshot.players.length);
    } finally {
      server.close();
    }
  });
});

describe('coercition de phase', () => {
  it('n’atterrit jamais sur une phase qui porte du matériel secret', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);

      // Les sept phases du jeu, éprouvées sur le même état.
      const phases = [
        'LOBBY',
        'IDENTITY_REVEAL',
        'CLUE_SELECTION',
        'GUESSING',
        'RESULTS',
        'SCOREBOARD',
        'FINAL_RESULTS',
      ] as const;

      for (const phase of phases) {
        const probe: Game = { ...party.game, phase, currentRound: 2 };
        expect(['LOBBY', 'SCOREBOARD', 'FINAL_RESULTS']).toContain(coerceRelayPhase(probe));
      }
    } finally {
      server.close();
    }
  });

  it('compte la manche en cours comme réglée dès la phase RESULTS', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);

      // Le piège : `settleRound` est appliqué à l'**entrée** de RESULTS, pas à
      // sa sortie. Les points de la manche N sont donc déjà dans les scores.
      // La tronquer produirait un classement dont le cumul dépasse la somme
      // des manches affichées.
      const inRound = { ...party.game, currentRound: 3 };

      expect(settledRoundCount({ ...inRound, phase: 'GUESSING' })).toBe(2);
      expect(settledRoundCount({ ...inRound, phase: 'RESULTS' })).toBe(3);
      expect(settledRoundCount({ ...inRound, phase: 'SCOREBOARD' })).toBe(3);
      expect(settledRoundCount({ ...inRound, phase: 'LOBBY' })).toBe(0);
    } finally {
      server.close();
    }
  });

  it('renvoie au salon une partie interrompue pendant sa première manche', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);
      const snapshot = await snapshotOf(party.game);

      // Aucune manche réglée : il n'y a rien à reprendre, et c'est très bien —
      // `startGame` redistribue les mains, donc le cas se règle tout seul.
      expect(snapshot.phase).toBe('LOBBY');
      expect(snapshot.currentRound).toBe(0);
      expect(snapshot.players.every((player) => player.score === 0)).toBe(true);
      expect(snapshot.players.every((player) => player.cardsLeft === 0)).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe('taille sur le fil', () => {
  it('tient très en dessous du plafond du canal, au pire cas', async () => {
    const server = startTestServer();
    try {
      // Le pire cas réaliste : huit joueurs, quatre manches réglées, pseudos au
      // maximum. Il compte parce que `HostNode.send` **avale** un dépassement
      // dans un `console.warn` : un instantané trop gros disparaîtrait en
      // silence, et la migration cesserait de marcher sans aucun symptôme.
      const party = await startedGame(server);
      const game = party.game;

      const snapshot = await buildRelaySnapshot(inflate(game), { epoch: 0, seq: 999 });
      const encoded = JSON.stringify({ t: 'evt', event: 'host:relay', payload: snapshot });

      expect(snapshot.players).toHaveLength(MAX_PLAYERS);
      expect(snapshot.rounds).toHaveLength(TOTAL_ROUNDS);
      expect(encoded.length).toBeLessThan(30_000);
    } finally {
      server.close();
    }
  });
});

describe('refus d’un instantané fabriqué', () => {
  it('rejette en bloc, sans jamais réparer à moitié', async () => {
    const server = startTestServer();
    try {
      const party = await startedGame(server);
      await playRound(party);
      const valid = await snapshotOf(party.game);

      // L'instantané authentique passe : sans ça, le reste ne prouverait rien.
      expect(parseRelaySnapshot(JSON.parse(JSON.stringify(valid)))).not.toBeNull();

      const first = valid.players[0]!;
      const mutations: Array<[string, () => unknown]> = [
        ['version inconnue', () => ({ ...valid, v: 2 })],
        ['hôte absent des joueurs', () => ({ ...valid, hostId: 'fantôme' })],
        ['trop de joueurs', () => ({ ...valid, players: repeat(valid.players, MAX_PLAYERS + 1) })],
        ['aucun joueur', () => ({ ...valid, players: [] })],
        [
          'identifiants en double',
          () => ({ ...valid, players: [first, { ...valid.players[1]!, id: first.id }] }),
        ],
        [
          'empreintes en double',
          () => ({
            ...valid,
            players: [first, { ...valid.players[1]!, sessionHash: first.sessionHash }],
          }),
        ],
        [
          'pseudos en double',
          () => ({
            ...valid,
            players: [first, { ...valid.players[1]!, nickname: first.nickname }],
          }),
        ],
        ['score absurde', () => withPlayer(valid, { score: 1e9 })],
        ['score négatif', () => withPlayer(valid, { score: -1 })],
        ['empreinte tronquée', () => withPlayer(valid, { sessionHash: 'abc' })],
        ['trop de cartes', () => withPlayer(valid, { cardsLeft: 99 })],
        ['phase en cours de manche', () => ({ ...valid, phase: 'GUESSING' })],
        ['manche incohérente', () => ({ ...valid, currentRound: valid.rounds.length + 1 })],
        ['plateau incomplet', () => withRound(valid, { board: ['a', 'b'] })],
        ['numéro hors plateau', () => withAssignment(valid, { slot: 99 })],
        ['numéro nul', () => withAssignment(valid, { slot: 0 })],
        ['salon avec des scores', () => ({ ...valid, phase: 'LOBBY', rounds: [], currentRound: 0 })],
      ];

      for (const [label, mutate] of mutations) {
        expect(parseRelaySnapshot(mutate()), label).toBeNull();
      }
    } finally {
      server.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────
//  Fabrication des cas
// ─────────────────────────────────────────────────────────────

/** Gonfle une partie au maximum du livret, pour mesurer le pire cas. */
function inflate(game: Game): Game {
  const source = [...game.players.values()][0];
  if (!source) throw new Error('partie vide');

  const players = new Map(game.players);
  for (let index = players.size; index < MAX_PLAYERS; index++) {
    const id = `${source.id}-clone-${index}`;
    players.set(id, {
      ...source,
      id,
      nickname: 'Pseudonyme12345'.slice(0, 16),
      score: 14,
      joinedAt: source.joinedAt + index,
    });
  }

  // Les pseudos doivent rester distincts : l'unicité est un invariant validé.
  let suffix = 0;
  for (const player of players.values()) {
    player.nickname = `Joueur${String(suffix++).padStart(9, '0')}`;
  }

  const rounds: Game['rounds'] = [];
  for (let number = 1; number <= TOTAL_ROUNDS; number++) {
    const assignments: Game['rounds'][number]['assignments'] = new Map();

    for (const id of players.keys()) {
      const votes: Record<string, number> = {};
      for (const other of players.keys()) {
        if (other !== id) votes[other] = 1;
      }
      assignments.set(id, {
        slot: 1,
        placed: [],
        cluesSubmitted: true,
        votes,
        votesSubmitted: true,
        roundScoreGiven: 3,
        roundScoreGuessed: 4,
      });
    }

    rounds.push({
      roundNumber: number,
      phase: 'RESULTS' as const,
      phaseEndsAt: null,
      board: Array.from({ length: 8 }, (_, i) => `identite-tres-longue-${i}`),
      assignments,
    });
  }

  return {
    ...game,
    phase: 'FINAL_RESULTS',
    currentRound: TOTAL_ROUNDS,
    players,
    rounds,
    usedIdentityIds: new Set(
      Array.from({ length: TOTAL_ROUNDS * 8 }, (_, i) => `identite-tres-longue-${i}`),
    ),
  };
}

function repeat<T>(items: T[], count: number): T[] {
  return Array.from({ length: count }, (_, index) => ({
    ...items[index % items.length],
    id: `clone-${index}`,
  })) as T[];
}

function withPlayer(snapshot: RelaySnapshot, patch: Record<string, unknown>): unknown {
  return {
    ...snapshot,
    players: [{ ...snapshot.players[0], ...patch }, ...snapshot.players.slice(1)],
  };
}

function withRound(snapshot: RelaySnapshot, patch: Record<string, unknown>): unknown {
  return {
    ...snapshot,
    rounds: [{ ...snapshot.rounds[0], ...patch }, ...snapshot.rounds.slice(1)],
  };
}

function withAssignment(snapshot: RelaySnapshot, patch: Record<string, unknown>): unknown {
  const round = snapshot.rounds[0]!;
  const [playerId, assignment] = round.assignments[0]!;

  return {
    ...snapshot,
    rounds: [
      { ...round, assignments: [[playerId, { ...assignment, ...patch }], ...round.assignments.slice(1)] },
      ...snapshot.rounds.slice(1),
    ],
  };
}

/** Sert uniquement à garder `PlayerView` importé pour la lisibilité du harnais. */
export type _ViewHint = PlayerView;
