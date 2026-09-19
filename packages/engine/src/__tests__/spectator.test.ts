import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  MAX_SPECTATORS,
  SERVER_EVENTS,
  type PictoCard,
  type PlacedPicto,
  type SpectatorView,
} from '@identite-secrete/shared';
import { TestClient, containsValue, startTestServer, type TestHost } from './helpers';

/**
 * L'écran de suivi (D-95).
 *
 * Un spectateur ne s'authentifie pas : il suffit du code de la partie, qui est
 * affiché en haut de l'écran de chaque joueur et lu à voix haute dans la pièce.
 * Ce fichier vérifie donc **une seule chose, de plusieurs façons** : tout ce
 * qui sort par ce chemin est déjà connu de tous les joueurs à cet instant.
 *
 * Si l'un de ces tests tombe, ce n'est pas un détail d'affichage : c'est qu'on
 * peut tricher en ouvrant `/tv` sur un second téléphone.
 */

let server: TestHost;
let clients: TestClient[] = [];
let spectators: TestSpectator[] = [];

/**
 * Un écran branché sur la partie.
 *
 * Il ne se sert pas de `TestClient`, et c'est volontaire : un spectateur n'a ni
 * session, ni pseudo, ni jointure — lui donner l'outillage d'un joueur
 * masquerait justement ce qu'on veut prouver.
 */
class TestSpectator {
  readonly id: string;
  readonly views: SpectatorView[] = [];
  readonly allPayloads: unknown[] = [];

  constructor(private readonly host: TestHost) {
    this.id = host.attach((event, payload) => {
      this.allPayloads.push(payload);
      if (event === SERVER_EVENTS.spectatorUpdate) this.views.push(payload as SpectatorView);
    });
  }

  watch(code: string) {
    return this.host.dispatch(this.id, CLIENT_EVENTS.spectate, { code });
  }

  emit<T>(event: string, payload: unknown) {
    return this.host.dispatch<T>(this.id, event, payload);
  }

  get last(): SpectatorView {
    const view = this.views.at(-1);
    if (!view) throw new Error('aucune vue de suivi reçue');
    return view;
  }

  /** Attend une vue satisfaisant `predicate`, celles déjà reçues comprises. */
  async waitFor(
    predicate: (view: SpectatorView) => boolean,
    label = 'vue de suivi',
    timeoutMs = 8_000,
  ): Promise<SpectatorView> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.views.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`délai dépassé : ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  close(): Promise<void> {
    return this.host.detach(this.id);
  }
}

async function connect(): Promise<TestClient> {
  const client = TestClient.connect(server);
  clients.push(client);
  return client;
}

function spectate(): TestSpectator {
  const spectator = new TestSpectator(server);
  spectators.push(spectator);
  return spectator;
}

/** Une partie à trois, lancée avec des phases assez longues pour être inspectées. */
async function startedGame(): Promise<{ code: string; players: TestClient[] }> {
  const host = await connect();
  const { code } = await host.createGame('Sarah');
  const players = [host];

  for (const nickname of ['Allan', 'Malo']) {
    const guest = await connect();
    await guest.joinGame(code, nickname);
    players.push(guest);
  }

  await host.waitForView((v) => v.players.length === 3, 'salon complet');
  await host.emit(CLIENT_EVENTS.updateSettings, { clueSeconds: 180, guessSeconds: 180 });
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

function handOf(client: TestClient): PictoCard[] {
  const hand = client.lastView.yourHand;
  if (!hand) throw new Error('main non reçue');
  return hand;
}

function place(cards: PictoCard[], count = 2): PlacedPicto[] {
  return cards.slice(0, count).map((card, index) => ({
    cardId: card.id,
    iconId: card.front[0],
    zone: index === 0 ? 'green' : 'red',
  }));
}

/** Les clés de tout un objet, en profondeur. */
function deepKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, found);
    return found;
  }
  if (value === null || typeof value !== 'object') return found;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    found.add(key);
    deepKeys(child, found);
  }
  return found;
}

beforeEach(() => {
  server = startTestServer();
});

afterEach(async () => {
  for (const spectator of spectators) await spectator.close();
  for (const client of clients) client.close();
  clients = [];
  spectators = [];
  server.close();
});

// ─────────────────────────────────────────────────────────────

describe("l'écran de suivi entre dans la partie", () => {
  it('reçoit une vue dès qu’il se déclare', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const tv = spectate();
    const ack = await tv.watch(code);

    expect(ack.ok).toBe(true);
    expect(tv.last.code).toBe(code);
    expect(tv.last.phase).toBe('LOBBY');
    expect(tv.last.players.map((p) => p.nickname)).toEqual(['Sarah']);
  });

  it('refuse un code qui ne correspond à aucune partie', async () => {
    const tv = spectate();
    const ack = await tv.watch('ZZZZZ');

    expect(ack.ok).toBe(false);
    if (!ack.ok) expect(ack.error.code).toBe('GAME_NOT_FOUND');
    expect(tv.views).toHaveLength(0);
  });

  it('ne prend aucune place à table', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const guest = await connect();
    await guest.joinGame(code, 'Allan');

    const tv = spectate();
    await tv.watch(code);

    const game = await server.store.get(code);
    expect(game?.players.size).toBe(2);
    expect(tv.last.players).toHaveLength(2);

    // Et la partie se lance : un spectateur ne se compte pas parmi ceux qu'on
    // attend, sans quoi elle resterait bloquée au salon.
    const started = await host.emit(CLIENT_EVENTS.startGame, {});
    expect(started.ok).toBe(true);
  });

  it('ne branche pas plus d’écrans que le plafond', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    for (let i = 0; i < MAX_SPECTATORS; i++) {
      const ack = await spectate().watch(code);
      expect(ack.ok).toBe(true);
    }

    const extra = await spectate().watch(code);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.error.code).toBe('SPECTATORS_FULL');
  });

  it('libère sa place en se débranchant', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const first: TestSpectator[] = [];
    for (let i = 0; i < MAX_SPECTATORS; i++) {
      const tv = spectate();
      await tv.watch(code);
      first.push(tv);
    }
    expect((await spectate().watch(code)).ok).toBe(false);

    await first[0]!.close();

    const after = await spectate().watch(code);
    expect(after.ok).toBe(true);
  });

  it('se rebranche sans consommer une place de plus', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');

    const tv = spectate();
    for (let i = 0; i < 5; i++) expect((await tv.watch(code)).ok).toBe(true);

    expect(server.host.spectators.count(code)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────

describe("l'écran de suivi ne peut pas jouer", () => {
  it('voit ses actions de jeu refusées', async () => {
    const { code, players } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    // Aucun joueur attaché à ce canal : chaque gestionnaire s'arrête à sa
    // première ligne, sans qu'aucun contrôle ne lui soit propre.
    const start = await tv.emit(CLIENT_EVENTS.startGame, {});
    expect(start.ok).toBe(false);

    const clues = await tv.emit(CLIENT_EVENTS.submitClues, {
      placed: place(handOf(players[0]!), 1),
    });
    expect(clues.ok).toBe(false);

    const next = await tv.emit(CLIENT_EVENTS.nextRound, {});
    expect(next.ok).toBe(false);

    const chat = await tv.emit(CLIENT_EVENTS.sendChat, { text: 'coucou' });
    expect(chat.ok).toBe(false);

    const game = await server.store.get(code);
    expect(game?.chat).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────

describe("l'écran de suivi ne reçoit rien de secret", () => {
  it('ne porte jamais de main de cartes Picto', async () => {
    const { code, players } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    const card = handOf(players[0]!)[0]!;

    await tv.waitFor((v) => v.phase === 'CLUE_SELECTION', 'phase de pose');
    for (const payload of tv.allPayloads) {
      expect(containsValue(payload, card.id)).toBe(false);
    }
  });

  it('ne montre pas les pictogrammes pendant la pose', async () => {
    const { code, players } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    await players[0]!.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(players[0]!)) });

    // On attend que la progression du joueur soit visible : c'est la preuve que
    // la vue est bien à jour, et donc que l'absence de pictogrammes n'est pas
    // seulement un retard d'affichage.
    const view = await tv.waitFor(
      (v) => v.phase === 'CLUE_SELECTION' && (v.cases ?? []).some((c) => c.submitted),
      'boîtier validé',
    );

    expect(view.cases).toHaveLength(3);
    for (const entry of view.cases ?? []) {
      expect(entry.placed).toEqual([]);
    }
  });

  it('ne porte ni numéro, ni vote, ni jeton avant la révélation', async () => {
    const { code, players } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    for (const player of players) {
      await player.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(player)) });
    }

    const view = await tv.waitFor((v) => v.phase === 'GUESSING', 'phase de vote');

    // Les boîtiers, eux, sont désormais publics : chaque joueur les a devant
    // les yeux. C'est le seul champ qui s'ouvre entre les deux phases.
    expect((view.cases ?? []).every((entry) => entry.placed.length === 2)).toBe(true);

    const forbidden = [
      'slot',
      'yourSlot',
      'hand',
      'yourHand',
      'sessionToken',
      'sessionTokenHash',
      'votes',
      'yourVotes',
      'cardId',
      'assignments',
      'reveals',
      'chat',
    ];
    const keys = deepKeys(view);
    for (const key of forbidden) expect(keys.has(key)).toBe(false);

    // Et le contrôle qui compte vraiment : le numéro que l'hôte détient
    // n'apparaît nulle part, sous aucune forme.
    const game = await server.store.get(code);
    const round = game?.rounds[0];
    const secret = round?.assignments.get(players[0]!.session!.playerId);
    expect(secret).toBeDefined();

    const emitted = JSON.stringify(tv.allPayloads);
    const identity = round!.board[secret!.slot - 1]!;
    // Le personnage est sur le plateau, donc public ; ce qui ne doit pas sortir,
    // c'est le lien entre lui et son joueur. Aucun objet de la vue ne réunit les
    // deux : la seule liste nominative, `cases`, n'a pas de champ pour ça.
    for (const entry of view.cases ?? []) {
      expect(Object.keys(entry).sort()).toEqual(['nickname', 'placed', 'playerId', 'submitted']);
    }
    expect(emitted).not.toContain('"yourSlot"');
    expect(identity).toBeTruthy();
  });

  it('révèle tout, et seulement à la révélation', async () => {
    const { code, players } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    for (const player of players) {
      await player.emit(CLIENT_EVENTS.submitClues, { placed: place(handOf(player)) });
    }
    await tv.waitFor((v) => v.phase === 'GUESSING', 'phase de vote');

    for (const player of players) {
      const view = player.lastView;
      const votes: Record<string, number> = {};
      for (const opponent of view.opponents ?? []) votes[opponent.playerId] = 1;
      await player.emit(CLIENT_EVENTS.submitGuesses, { votes });
    }

    const view = await tv.waitFor((v) => v.phase === 'RESULTS', 'révélation');

    expect(view.reveals).toHaveLength(3);
    expect(view.roundScores).toHaveLength(3);
    // La révélation de l'écran est **exactement** celle des joueurs : à ce
    // stade, il n'y a plus rien à cacher à personne.
    expect(view.reveals).toEqual(players[0]!.lastView.reveals);
  });
});

// ─────────────────────────────────────────────────────────────

describe("l'écran de suivi suit la partie", () => {
  it('reçoit les changements de phase sans rien demander', async () => {
    const { code } = await startedGame();
    const tv = spectate();
    await tv.watch(code);

    const seen = new Set(tv.views.map((v) => v.phase));
    expect(seen.has('CLUE_SELECTION')).toBe(true);

    const view = tv.last;
    expect(view.roundNumber).toBe(1);
    expect(view.totalRounds).toBeGreaterThan(0);
    expect(view.board).toHaveLength(8);
    expect(view.phaseEndsAt).not.toBeNull();
  });

  it('ne renvoie pas deux fois la même vue', async () => {
    const host = await connect();
    const { code } = await host.createGame('Sarah');
    const tv = spectate();
    await tv.watch(code);

    const before = tv.views.length;

    // Le rattrapage d'échéances tourne en continu chez l'hôte : sans la
    // comparaison d'empreinte, une partie immobile inonderait la télé.
    for (let i = 0; i < 5; i++) await server.host.tickAll();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(tv.views.length).toBe(before);
  });
});
