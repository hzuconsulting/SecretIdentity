import { io as createClient, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Ack,
  type PlayerView,
  type SessionPayload,
} from '@identite-secrete/shared';
import { createGameServer, type GameServer } from '../server';

/**
 * Harnais des tests d'intégration.
 *
 * De vrais sockets, un vrai serveur, un vrai port. Rien n'est simulé : le seul
 * ajustement est la durée des périodes de grâce, injectée par `createGameServer`
 * pour ne pas attendre 60 secondes par test.
 */

export const TEST_GRACE_MS = 120;
export const TEST_HOST_TRANSFER_MS = 80;
/** Une phase réglée sur 60 s dure 600 ms dans les tests. */
export const TEST_TIME_SCALE = 0.01;

export async function startTestServer(): Promise<{ server: GameServer; url: string }> {
  const server = createGameServer({
    port: 0,
    clientOrigins: ['*'],
    disconnectGraceMs: TEST_GRACE_MS,
    hostTransferDelayMs: TEST_HOST_TRANSFER_MS,
    timeScale: TEST_TIME_SCALE,
    enableCleanup: false,
  });

  const port = await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

/**
 * Un client de test.
 *
 * Il **enregistre tous les états reçus** : c'est ce qui permet de vérifier
 * qu'aucun payload destiné à B ne contient un secret de A, y compris dans les
 * messages qu'on n'attendait pas.
 */
export class TestClient {
  readonly socket: Socket;
  readonly received: PlayerView[] = [];
  readonly allPayloads: unknown[] = [];

  session: SessionPayload | null = null;

  private constructor(socket: Socket) {
    this.socket = socket;

    socket.on(SERVER_EVENTS.stateUpdate, (view: PlayerView) => {
      this.received.push(view);
    });

    // Filet large : on capture absolument tout ce qui arrive sur cette socket.
    socket.onAny((_event: string, ...args: unknown[]) => {
      this.allPayloads.push(...args);
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = createClient(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('connexion trop lente')), 4_000);
      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    return new TestClient(socket);
  }

  /** Émission avec acquittement typé. */
  emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return new Promise<Ack<T>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`pas d'acquittement : ${event}`)), 4_000);
      this.socket.emit(event, payload, (response: Ack<T>) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
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
    return new Promise<PlayerView>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off(SERVER_EVENTS.stateUpdate, listener);
        reject(new Error(`délai dépassé : ${label}`));
      }, timeoutMs);

      const listener = (view: PlayerView) => {
        if (!predicate(view)) return;
        clearTimeout(timeout);
        this.socket.off(SERVER_EVENTS.stateUpdate, listener);
        resolve(view);
      };

      this.socket.on(SERVER_EVENTS.stateUpdate, listener);
    });
  }

  /** Attend une vue satisfaisant `predicate`, ou échoue. */
  async waitForView(
    predicate: (view: PlayerView) => boolean,
    label = 'vue attendue',
    timeoutMs = 3_000,
  ): Promise<PlayerView> {
    const existing = this.received.find(predicate);
    if (existing) return existing;

    return new Promise<PlayerView>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.off(SERVER_EVENTS.stateUpdate, listener);
        reject(new Error(`délai dépassé : ${label}`));
      }, timeoutMs);

      const listener = (view: PlayerView) => {
        if (!predicate(view)) return;
        clearTimeout(timeout);
        this.socket.off(SERVER_EVENTS.stateUpdate, listener);
        resolve(view);
      };

      this.socket.on(SERVER_EVENTS.stateUpdate, listener);
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}

/** Petite attente explicite, pour laisser une échéance serveur se déclencher. */
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
