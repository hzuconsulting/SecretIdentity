import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Ack,
  type PlayerView,
  type RelaySnapshot,
  type SessionPayload,
} from '@identite-secrete/shared';
import { GameHost, type AdoptOptions, type GameHostOptions } from '../host';
import type { GameStore } from '../store/GameStore';
import type { TimerRegistry } from '../timers';
import { setLogLevel } from '../logger';

/**
 * Harnais des tests d'intégration.
 *
 * Un vrai `GameHost`, de vrais minuteurs, de vraies parties jouées de bout en
 * bout — mais plus de sockets ni de ports. Depuis que le moteur tourne dans le
 * navigateur de l'hôte, le transport n'est plus ce qu'on veut éprouver : ce
 * qu'on veut éprouver, c'est que les règles, les phases et la confidentialité
 * tiennent face à des messages arbitraires, et ça, un canal en mémoire le
 * reproduit fidèlement.
 *
 * Ce que la suppression des sockets change vraiment : les acquittements
 * arrivent après que les diffusions ont été enregistrées, donc plus aucune
 * course à l'ordonnancement. Les tests qui attendaient une vue continuent de
 * l'attendre, mais ils ne peuvent plus passer par chance.
 *
 * Le seul ajustement conservé est la durée des délais, injectée par
 * `startTestServer` pour ne pas attendre 60 secondes par test.
 */

setLogLevel('error');

export const TEST_GRACE_MS = 120;
export const TEST_HOST_TRANSFER_MS = 80;
/** Une phase réglée sur 60 s dure 600 ms dans les tests. */
export const TEST_TIME_SCALE = 0.01;

type Sink = (event: string, payload: unknown) => void;

/**
 * Le nœud sous test, plus l'aiguillage vers les clients connectés.
 *
 * Il joue le rôle que tenait le serveur : les tests l'interrogent par
 * `server.store` pour connaître la vérité — les identités, la table des
 * étiquettes — et vérifier que les clients, eux, ne l'ont pas reçue.
 */
export class TestHost {
  readonly host: GameHost;
  private readonly sinks = new Map<string, Sink>();
  private nextId = 0;

  constructor(options: GameHostOptions = {}, adopted?: GameHost) {
    const emit = (connectionId: string, event: string, payload: unknown) => {
      this.sinks.get(connectionId)?.(event, payload);
    };

    this.host = adopted ?? new GameHost({ ...testDefaults(), ...options, emit });
    // Un nœud construit par `GameHost.adopt` existe avant ce harnais : on lui
    // rebranche l'aiguillage plutôt que de le reconstruire.
    if (adopted) this.host.setEmitListener(emit);
  }

  get store(): GameStore {
    return this.host.store;
  }

  /** Le registre d'échéances, pour vérifier qu'aucune ne survit à sa partie. */
  get timers(): TimerRegistry {
    return this.host.timers;
  }

  /** Ouvre un canal et retourne son identifiant. */
  attach(sink: Sink): string {
    const id = `test-${++this.nextId}`;
    this.sinks.set(id, sink);
    this.host.connect(id);
    return id;
  }

  /** Ferme un canal : période de grâce, transfert d'hôte, pause éventuelle. */
  detach(connectionId: string): Promise<void> {
    this.sinks.delete(connectionId);
    return this.host.disconnect(connectionId, 'test close');
  }

  dispatch<T>(connectionId: string, event: string, payload: unknown): Promise<Ack<T>> {
    return this.host.dispatch(connectionId, event, payload) as Promise<Ack<T>>;
  }

  close(): void {
    this.sinks.clear();
    this.host.close();
  }
}

function testDefaults(): GameHostOptions {
  return {
    disconnectGraceMs: TEST_GRACE_MS,
    hostTransferDelayMs: TEST_HOST_TRANSFER_MS,
    timeScale: TEST_TIME_SCALE,
    enableCleanup: false,
  };
}

export function startTestServer(options: GameHostOptions = {}): TestHost {
  return new TestHost(options);
}

/**
 * Un nœud qui **reprend** une partie à partir d'un instantané de relais.
 *
 * C'est le nœud d'un joueur qui vient de constater la disparition de l'hôte et
 * qui prend sa place. Le détour par une fabrique est nécessaire parce que
 * `GameHost.adopt` est asynchrone : le `TestHost` doit exister avant, pour que
 * son aiguillage de messages soit branché quand la reprise diffuse.
 */
export async function adoptTestServer(
  snapshot: RelaySnapshot,
  options: AdoptOptions = {},
): Promise<TestHost> {
  const host = await GameHost.adopt(snapshot, { ...testDefaults(), ...options });
  return new TestHost({}, host);
}

/**
 * Un client de test.
 *
 * Il **enregistre tous les états reçus** : c'est ce qui permet de vérifier
 * qu'aucun payload destiné à B ne contient un secret de A, y compris dans les
 * messages qu'on n'attendait pas.
 */
export class TestClient {
  readonly id: string;
  readonly received: PlayerView[] = [];
  readonly allPayloads: unknown[] = [];

  connected = true;
  session: SessionPayload | null = null;

  private readonly listeners = new Map<string, Set<(payload: never) => void>>();

  private constructor(private readonly server: TestHost) {
    this.id = server.attach((event, payload) => this.receive(event, payload));
  }

  static connect(server: TestHost): TestClient {
    return new TestClient(server);
  }

  private receive(event: string, payload: unknown): void {
    // Filet large : on capture absolument tout ce qui arrive sur ce canal.
    this.allPayloads.push(payload);
    if (event === SERVER_EVENTS.stateUpdate) this.received.push(payload as PlayerView);

    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (value: unknown) => void)(payload);
    }
  }

  on<T>(event: string, listener: (payload: T) => void): void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as (payload: never) => void);
    this.listeners.set(event, set);
  }

  off<T>(event: string, listener: (payload: T) => void): void {
    this.listeners.get(event)?.delete(listener as (payload: never) => void);
  }

  /** Émission avec acquittement typé. */
  async emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    if (!this.connected) throw new Error(`canal fermé : ${event}`);
    return this.server.dispatch<T>(this.id, event, payload);
  }

  async createGame(nickname: string): Promise<SessionPayload> {
    const response = await this.emit<SessionPayload>(CLIENT_EVENTS.createGame, { nickname });
    if (!response.ok) throw new Error(`création refusée : ${response.error.code}`);
    this.session = response.data;
    return response.data;
  }

  async joinGame(code: string, nickname: string): Promise<SessionPayload> {
    const response = await this.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
      code,
      nickname,
    });
    if (!response.ok) throw new Error(`jointure refusée : ${response.error.code}`);
    this.session = response.data;
    return response.data;
  }

  /** Dernière vue reçue. */
  get lastView(): PlayerView {
    const view = this.received.at(-1);
    if (!view) throw new Error('aucune vue reçue');
    return view;
  }

  /**
   * Attend une vue **à venir**, en ignorant celles déjà reçues.
   *
   * Indispensable pour tester une reprise : `waitForView` trouverait une vue
   * d'avant la pause qui satisfait déjà « non en pause », et le test passerait
   * sans rien vérifier.
   */
  waitForNextView(
    predicate: (view: PlayerView) => boolean,
    label = 'vue attendue',
    timeoutMs = 5_000,
  ): Promise<PlayerView> {
    return this.waitFor(predicate, label, timeoutMs, false);
  }

  /** Attend une vue satisfaisant `predicate`, ou échoue. */
  waitForView(
    predicate: (view: PlayerView) => boolean,
    label = 'vue attendue',
    timeoutMs = 3_000,
  ): Promise<PlayerView> {
    return this.waitFor(predicate, label, timeoutMs, true);
  }

  private waitFor(
    predicate: (view: PlayerView) => boolean,
    label: string,
    timeoutMs: number,
    acceptExisting: boolean,
  ): Promise<PlayerView> {
    if (acceptExisting) {
      const existing = this.received.find(predicate);
      if (existing) return Promise.resolve(existing);
    }

    return new Promise<PlayerView>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off(SERVER_EVENTS.stateUpdate, listener);
        reject(new Error(`délai dépassé : ${label}`));
      }, timeoutMs);

      const listener = (view: PlayerView) => {
        if (!predicate(view)) return;
        clearTimeout(timeout);
        this.off(SERVER_EVENTS.stateUpdate, listener);
        resolve(view);
      };

      this.on<PlayerView>(SERVER_EVENTS.stateUpdate, listener);
    });
  }

  /** Ferme le canal, comme un onglet qu'on ferme. */
  close(): void {
    if (!this.connected) return;
    this.connected = false;
    void this.server.detach(this.id);
  }

  disconnect(): void {
    this.close();
  }
}

/** Petite attente explicite, pour laisser une échéance se déclencher. */
/**
 * Attend la fin d'une manche précise, révélation affichée.
 *
 * Le numéro de manche est indispensable : `waitForView` accepte aussi les vues
 * déjà reçues, et retrouverait sinon la révélation d'une manche précédente.
 */
export function waitForRoundEnd(
  client: TestClient,
  roundNumber: number,
  timeoutMs = 15_000,
): Promise<PlayerView> {
  return client.waitForView(
    (view) => view.phase === 'RESULTS' && view.roundNumber === roundNumber,
    `révélation de la manche ${roundNumber}`,
    timeoutMs,
  );
}

/**
 * Laisse la partie se jouer jusqu'au classement final.
 *
 * Les phases de jeu se concluent seules, à l'échéance de leur minuteur. La fin
 * de manche, elle, n'en a plus : c'est l'hôte qui enchaîne. Ce harnais appuie
 * donc sur « Manche suivante » à chaque fois que la partie l'attend — et rien
 * d'autre.
 */
export async function hostPlaysToTheEnd(
  host: TestClient,
  timeoutMs = 25_000,
): Promise<PlayerView> {
  const deadline = Date.now() + timeoutMs;
  let pressedFor = -1;

  for (;;) {
    const view = host.lastView;
    if (view.phase === 'FINAL_RESULTS') return view;

    const waitingForHost = view.phase === 'RESULTS' || view.phase === 'SCOREBOARD';
    if (waitingForHost && !view.paused && pressedFor !== view.roundNumber) {
      pressedFor = view.roundNumber;
      await host.emit(CLIENT_EVENTS.nextRound, {});
    }

    if (Date.now() > deadline) throw new Error('délai dépassé : fin de partie');
    await wait(20);
  }
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Recherche récursive d'une valeur dans un payload arbitraire. */
export function containsValue(payload: unknown, needle: string): boolean {
  if (typeof payload === 'string') return payload === needle;
  if (payload === null || typeof payload !== 'object') return false;

  if (Array.isArray(payload)) {
    return payload.some((item) => containsValue(item, needle));
  }

  return Object.values(payload as Record<string, unknown>).some((value) =>
    containsValue(value, needle),
  );
}
