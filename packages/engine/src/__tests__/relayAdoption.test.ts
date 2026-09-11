import { describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  MIN_PLAYERS,
  type Game,
  type PlayerView,
  type RelaySnapshot,
  type SessionPayload,
} from '@identite-secrete/shared';
import { buildRelaySnapshot } from '../serialization/relay';
import { sha256Hex } from '../random';
import {
  TEST_GRACE_MS,
  TEST_HOST_TRANSFER_MS,
  TestClient,
  TestHost,
  adoptTestServer,
  startTestServer,
  wait,
} from './helpers';

/**
 * La reprise d'hébergement.
 *
 * Le scénario : l'hôte disparaît pour de bon — batterie vide, onglet fermé,
 * tunnel sans fin — et un autre joueur reprend le moteur à partir de
 * l'instantané qu'il avait reçu.
 *
 * Ce qu'on éprouve ici est la **correction du moteur** après reprise, de façon
 * déterministe : deux `GameHost` dans le même processus, sans réseau. La course
 * à la réservation de l'identifiant, elle, relève du transport et se teste dans
 * `scripts/e2e-migration.mjs`.
 *
 * Les deux pièges qui ont motivé ces tests :
 *
 * 1. **Le verrou mortel.** Après une reprise, aucun `handleDisconnect` n'a eu
 *    lieu pour le disparu. Si personne n'arme le transfert du salon, `hostId`
 *    désigne un fantôme — et comme lancer, enchaîner, rejouer et régler exigent
 *    tous d'être hôte, la partie est bloquée pour de bon.
 * 2. **Le double comptage.** `settleRound` s'applique à l'entrée de `RESULTS`.
 *    Reprendre au mauvais endroit ferait compter une manche deux fois, ou
 *    afficher un cumul qui ne correspond pas aux manches listées.
 */

// ─────────────────────────────────────────────────────────────
//  Harnais
// ─────────────────────────────────────────────────────────────

interface Party {
  server: TestHost;
  code: string;
  clients: TestClient[];
  sessions: SessionPayload[];
}

async function startedGame(server: TestHost): Promise<Party> {
  const host = TestClient.connect(server);
  const hostSession = await host.createGame('Hôte');
  const code = hostSession.code;

  const second = TestClient.connect(server);
  const secondSession = await second.joinGame(code, 'Bea');
  const third = TestClient.connect(server);
  const thirdSession = await third.joinGame(code, 'Cléo');

  const clients = [host, second, third];
  const started = clients.map((client) =>
    client.waitForView((view) => view.phase === 'CLUE_SELECTION', 'sélection des indices'),
  );
  await host.emit(CLIENT_EVENTS.startGame, {});
  await Promise.all(started);

  return { server, code, clients, sessions: [hostSession, secondSession, thirdSession] };
}

/** Joue une manche complète et s'arrête au classement. */
async function playRound(party: Party): Promise<void> {
  const { clients } = party;

  const atGuessing = clients.map((client) =>
    client.waitForNextView((view) => view.phase === 'GUESSING', 'devinette'),
  );
  for (const client of clients) {
    const card = (client.lastView.yourHand ?? [])[0];
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
    const votes: Record<string, number> = {};
    for (const opponent of client.lastView.opponents ?? []) votes[opponent.playerId] = 1;
    await client.emit(CLIENT_EVENTS.submitGuesses, { votes });
  }
  await Promise.all(atRoundEnd);
}

async function gameOf(server: TestHost, code: string): Promise<Game> {
  const game = await server.store.get(code);
  if (!game) throw new Error('partie introuvable');
  return game;
}

/** Joue une manche, puis produit l'instantané que les invités auraient reçu. */
async function snapshotAfterOneRound(
  server: TestHost,
): Promise<{ party: Party; snapshot: RelaySnapshot; game: Game }> {
  const party = await startedGame(server);
  await playRound(party);

  const game = await gameOf(server, party.code);
  const snapshot = await buildRelaySnapshot(game, { epoch: 0, seq: 3 });
  return { party, snapshot, game };
}

/** Reconnecte un joueur au nœud repris, avec le jeton qu'il avait déjà. */
async function rejoin(
  server: TestHost,
  session: SessionPayload,
): Promise<{ client: TestClient; ack: { ok: boolean } }> {
  const client = TestClient.connect(server);
  const ack = await client.emit<SessionPayload>(CLIENT_EVENTS.rejoinGame, {
    sessionToken: session.sessionToken,
  });
  return { client, ack };
}

// ─────────────────────────────────────────────────────────────

describe('reprise par un autre joueur', () => {
  it('repart du classement, et chacun revient avec le jeton qu’il avait déjà', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot, game } = await snapshotAfterOneRound(origin);
      const scoresBefore = [...game.players.values()].map((p) => [p.nickname, p.score] as const);
      const handsBefore = new Map(
        [...game.players.values()].map((p) => [p.id, p.hand.length] as const),
      );

      // L'hôte disparaît, le deuxième joueur reprend.
      origin.close();
      taker = await adoptTestServer(snapshot, { selfPlayerId: party.sessions[1]!.playerId });

      const adopted = await gameOf(taker, party.code);

      // La génération progresse : c'est ce qui permettra aux clients d'ignorer
      // une vue émise par l'ancien hôte s'il revenait.
      expect(adopted.epoch).toBe(1);

      // Les scores acquis sont intacts, et le nombre de cartes aussi — c'est le
      // départage du classement, le perdre serait une injustice visible.
      expect([...adopted.players.values()].map((p) => [p.nickname, p.score] as const)).toEqual(
        scoresBefore,
      );
      for (const [id, count] of handsBefore) {
        expect(adopted.players.get(id)?.hand.length, id).toBe(count);
      }

      // Personne n'est connecté : la partie est en pause, et n'avance pas seule.
      expect(adopted.pausedAt).not.toBeNull();

      // Les trois reviennent avec leur jeton d'origine, sans reformulaire.
      for (const session of party.sessions) {
        const { ack } = await rejoin(taker, session);
        expect(ack.ok, 'reconnexion refusée').toBe(true);
      }

      const resumed = await gameOf(taker, party.code);
      expect(resumed.pausedAt).toBeNull();
      expect(resumed.phase).toBe('SCOREBOARD');
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('ne compte pas les points de la manche interrompue deux fois', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot, game } = await snapshotAfterOneRound(origin);
      const before = new Map([...game.players.values()].map((p) => [p.id, p.score] as const));
      origin.close();

      taker = await adoptTestServer(snapshot);
      for (const session of party.sessions) await rejoin(taker, session);

      const resumed = await gameOf(taker, party.code);
      for (const [id, score] of before) {
        expect(resumed.players.get(id)?.score, id).toBe(score);
      }

      // Le cumul affiché correspond bien à la somme des manches listées : c'est
      // le contrôle qui attrape une troncature d'une manche de trop.
      const total = [...resumed.players.values()].reduce((sum, p) => sum + p.score, 0);
      const perRound = resumed.rounds.reduce(
        (sum, round) =>
          sum +
          [...round.assignments.values()].reduce(
            (inner, a) => inner + a.roundScoreGiven + a.roundScoreGuessed,
            0,
          ),
        0,
      );
      expect(total).toBe(perRound);
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('n’avance pas tant que le compte de joueurs n’est pas revenu', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();
      taker = await adoptTestServer(snapshot);

      // Un seul revenant : trop peu pour repartir.
      await rejoin(taker, party.sessions[0]!);

      const paused = await gameOf(taker, party.code);
      expect(paused.pausedAt).not.toBeNull();
      // Aucune échéance de phase armée : sinon le classement enchaînerait tout
      // seul sur la manche suivante pendant que les autres se rebranchent.
      expect(taker.timers.has(`${party.code}:phase`)).toBe(false);

      await wait(60);
      expect((await gameOf(taker, party.code)).phase).toBe('SCOREBOARD');

      // Le compte y est : la partie repart, avec une échéance neuve.
      for (const session of party.sessions.slice(1)) await rejoin(taker, session);

      const resumed = await gameOf(taker, party.code);
      expect(resumed.pausedAt).toBeNull();
      expect(MIN_PLAYERS).toBe(3);
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('ouvre la manche suivante avec des cartes en main et un numéro secret', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();

      // L'hôte du salon est le premier joueur : il revient, donc il garde le salon.
      taker = await adoptTestServer(snapshot, { selfPlayerId: party.sessions[0]!.playerId });

      const clients: TestClient[] = [];
      for (const session of party.sessions) {
        const { client } = await rejoin(taker, session);
        clients.push(client);
      }

      const atReveal = clients.map((client) =>
        client.waitForNextView((view) => view.phase === 'IDENTITY_REVEAL', 'révélation'),
      );
      const ack = await clients[0]!.emit(CLIENT_EVENTS.nextRound, {});
      expect(ack.ok, 'manche suivante refusée').toBe(true);
      const views = await Promise.all(atReveal);

      for (const view of views) {
        // Chacun a bien un numéro — donc la manche a été distribuée normalement.
        expect(view.yourSlot).toBeGreaterThanOrEqual(1);
        expect(view.roundNumber).toBe(2);
      }

      // Et des cartes pour jouer : sans elles, la manche serait injouable et le
      // classement final s'écroulerait sur un départage à zéro.
      const inClueSelection = clients.map((client) =>
        client.waitForNextView((view) => view.phase === 'CLUE_SELECTION', 'indices'),
      );
      const hands = await Promise.all(inClueSelection);
      for (const view of hands) {
        expect((view.yourHand ?? []).length).toBeGreaterThan(0);
      }
    } finally {
      origin.close();
      taker?.close();
    }
  });
});

describe('le salon après une reprise', () => {
  it('passe à l’adoptant quand l’hôte du salon a disparu de la partie', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();

      // L'hôte du salon n'est plus dans l'instantané : il a quitté avant la coupure.
      const orphan: RelaySnapshot = {
        ...snapshot,
        players: snapshot.players.filter((p) => p.id !== snapshot.hostId),
      };

      const adoptant = party.sessions[1]!.playerId;
      taker = await adoptTestServer(orphan, { selfPlayerId: adoptant });

      const adopted = await gameOf(taker, party.code);
      // Sans ça, `hostId` désignerait un fantôme et plus personne ne pourrait
      // lancer, enchaîner ni rejouer — la partie serait bloquée pour de bon.
      expect(adopted.hostId).toBe(adoptant);
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('transfère le salon si l’hôte ne revient pas du tout', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();
      taker = await adoptTestServer(snapshot);

      const hostId = snapshot.hostId;
      expect((await gameOf(taker, party.code)).hostId).toBe(hostId);

      // Les deux autres reviennent, l'hôte non. L'échéance de transfert doit
      // avoir été armée par la reprise — sinon elle n'existe nulle part.
      for (const session of party.sessions.slice(1)) await rejoin(taker, session);
      await wait(TEST_HOST_TRANSFER_MS + 60);

      const after = await gameOf(taker, party.code);
      expect(after.hostId).not.toBe(hostId);
      expect(after.players.get(after.hostId)?.connected).toBe(true);
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('retire un joueur qui ne revient jamais', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();
      taker = await adoptTestServer(snapshot);

      const absent = party.sessions[2]!.playerId;
      for (const session of party.sessions.slice(0, 2)) await rejoin(taker, session);

      // Sans échéance armée à la reprise, ce fantôme occuperait un siège pour
      // toujours et entrerait dans chaque manche suivante.
      await wait(TEST_GRACE_MS + 80);
      expect((await gameOf(taker, party.code)).players.has(absent)).toBe(false);
    } finally {
      origin.close();
      taker?.close();
    }
  });
});

describe('reconnexion par empreinte', () => {
  it('refuse une empreinte présentée comme si c’était un jeton', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();
      taker = await adoptTestServer(snapshot);

      // Le cœur du dispositif. L'instantané est diffusé à **tout le monde** :
      // si présenter l'empreinte d'un voisin suffisait à reprendre sa session,
      // n'importe quel joueur lirait le numéro secret de n'importe quel autre,
      // et le jeu entier s'effondrerait.
      const victim = snapshot.players.find((p) => p.id !== party.sessions[0]!.playerId);
      expect(victim).toBeDefined();

      const usurper = TestClient.connect(taker);
      const ack = await usurper.emit(CLIENT_EVENTS.rejoinGame, {
        sessionToken: victim!.sessionHash,
      });

      expect(ack.ok).toBe(false);
      if (!ack.ok) expect(ack.error.code).toBe('SESSION_NOT_FOUND');
    } finally {
      origin.close();
      taker?.close();
    }
  });

  it('n’accepte l’empreinte qu’une fois, puis repasse au jeton réel', async () => {
    const origin = startTestServer();
    let taker: TestHost | null = null;

    try {
      const { party, snapshot } = await snapshotAfterOneRound(origin);
      origin.close();
      taker = await adoptTestServer(snapshot);

      const session = party.sessions[0]!;
      const hash = await sha256Hex(session.sessionToken);
      expect(snapshot.players.some((p) => p.sessionHash === hash)).toBe(true);

      const first = await rejoin(taker, session);
      expect(first.ack.ok).toBe(true);

      // L'engagement a fait son office et disparaît : il ne doit pas rester une
      // seconde porte d'entrée sur cette session pour le reste de la partie.
      const game = await gameOf(taker, party.code);
      const player = game.players.get(session.playerId);
      expect(player?.sessionTokenHash).toBeUndefined();
      expect(player?.sessionToken).toBe(session.sessionToken);

      // Et le jeton réel continue de fonctionner, comme pour une partie ordinaire.
      const second = await rejoin(taker, session);
      expect(second.ack.ok).toBe(true);
    } finally {
      origin.close();
      taker?.close();
    }
  });
});

/** Garde `PlayerView` référencé : le harnais le manipule à travers `TestClient`. */
export type _ViewHint = PlayerView;
