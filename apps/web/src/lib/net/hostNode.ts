'use client';

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { GameHost, InMemoryStore } from '@identite-secrete/engine';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  defaultRng,
  generateGameCode,
  type Ack,
  type SessionPayload,
} from '@identite-secrete/shared';
import { peerIdForCode } from '@/lib/config';
import { NodeEvents, type GameNode, type NodeStatus, type StatusHandler } from './node';
import { PeerUnavailableError, openPeer } from './peer';
import { clearHostedGame, loadHostedGame, saveHostedGame } from './hostStorage';
import { parseClientMessage, type HostMessage } from './protocol';

/**
 * Le nœud qui héberge la partie.
 *
 * C'est l'ancien serveur, réduit à un onglet de navigateur. Il fait tourner le
 * `GameHost` — le même code que les tests exercent — et ne se sert du service
 * de signalisation que pour être trouvé : une fois les canaux WebRTC ouverts,
 * les messages vont directement d'un téléphone à l'autre.
 *
 * Le joueur qui héberge est **aussi** un joueur. Il passe par le même moteur
 * que les autres, sous l'identifiant de connexion `local`, et reçoit sa vue par
 * le même chemin — ce qui garantit qu'il ne voit rien de plus qu'eux, malgré
 * l'état complet à portée de main dans le même onglet.
 */

/** L'identifiant de connexion du joueur qui héberge. */
const LOCAL = 'local';

/** Nombre de codes essayés avant d'abandonner la création d'une partie. */
const CODE_ATTEMPTS = 6;

/**
 * Rythme du filet de sécurité sur les échéances.
 *
 * Le chemin nominal reste les `setTimeout` du moteur. Ce battement ne sert qu'au
 * cas où le navigateur les a gelés — onglet en arrière-plan, téléphone
 * verrouillé — auquel cas il est de toute façon gelé lui aussi, et ne rattrape
 * qu'au réveil. C'est exactement ce qu'on veut.
 */
const TICK_INTERVAL_MS = 1_000;

export class HostNode implements GameNode {
  readonly hosting = true;

  private readonly events = new NodeEvents();
  private readonly connections = new Map<string, DataConnection>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private detachWindow: (() => void) | null = null;

  private constructor(
    readonly code: string,
    private readonly peer: Peer,
    private readonly host: GameHost,
  ) {
    this.host.setEmitListener((connectionId, event, payload) => {
      this.deliver(connectionId, event, payload);
    });

    this.peer.on('connection', (connection) => this.accept(connection));
    this.peer.on('error', (error) => this.onPeerError(error));
    this.peer.on('disconnected', () => {
      // Le canal de signalisation est tombé : les parties WebRTC déjà ouvertes
      // continuent, mais plus personne ne peut nous rejoindre. On se réenregistre.
      if (!this.peer.destroyed) this.peer.reconnect();
    });

    this.events.setStatus('online');
    this.startTicking();
    this.watchWindow();
  }

  // ─────────────────────────────────────────────────────────
  //  Construction
  // ─────────────────────────────────────────────────────────

  /**
   * Crée une partie : réserve un code, puis construit le moteur autour.
   *
   * L'ordre compte. Le code **est** l'identifiant de signalisation, donc il
   * doit être accepté par le courtier avant que la partie n'existe — sinon on
   * afficherait à l'hôte un code que personne ne peut joindre.
   */
  static async create(nickname: string): Promise<{ node: HostNode; session: SessionPayload }> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const code = generateGameCode(defaultRng);

      let peer: Peer;
      try {
        peer = await openPeer(peerIdForCode(code));
      } catch (error) {
        lastError = error;
        // Code déjà pris par une autre partie en cours : on en tire un autre.
        if (error instanceof PeerUnavailableError) continue;
        throw error;
      }

      const host = new GameHost({ fixedCode: code });
      const node = new HostNode(code, peer, host);

      const ack = await node.emit<SessionPayload>(CLIENT_EVENTS.createGame, { nickname });
      if (!ack.ok) {
        node.close();
        throw new Error(ack.error.message);
      }

      node.persistNow();
      return { node, session: ack.data };
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Impossible de réserver un code de partie.');
  }

  /**
   * Reprend une partie que cet appareil hébergeait déjà.
   *
   * Sert au rafraîchissement de page — volontaire ou imposé par le système. Les
   * jetons de session des joueurs sont conservés, donc leurs onglets se
   * reconnectent tout seuls, sans repasser par le formulaire de pseudo.
   *
   * Retourne `null` si rien n'est stocké sous ce code.
   */
  static async restore(code: string): Promise<HostNode | null> {
    const game = loadHostedGame(code);
    if (!game) return null;

    const store = new InMemoryStore();
    await store.create(game);

    // Le courtier garde brièvement l'ancien identifiant après la fermeture de
    // l'onglet : on retente, sinon un simple rafraîchissement perdrait la partie.
    const peer = await claimWithRetry(peerIdForCode(code));

    const host = new GameHost({ store, fixedCode: code });
    return new HostNode(code, peer, host);
  }

  // ─────────────────────────────────────────────────────────
  //  Interface GameNode
  // ─────────────────────────────────────────────────────────

  get status(): NodeStatus {
    return this.events.status;
  }

  /** Une action du joueur qui héberge : elle passe par le moteur, comme les autres. */
  emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    return this.host.dispatch(LOCAL, event, payload) as Promise<Ack<T>>;
  }

  on<T>(event: string, handler: (payload: T) => void): void {
    this.events.on(event, handler);
  }

  off<T>(event: string, handler: (payload: T) => void): void {
    this.events.off(event, handler);
  }

  onStatus(handler: StatusHandler): () => void {
    return this.events.onStatus(handler);
  }

  /**
   * Ferme le nœud et **efface la partie**.
   *
   * Appelé quand l'hôte quitte volontairement. On ne garde pas la sauvegarde :
   * elle ferait revenir une partie que le joueur croit terminée.
   */
  close(): void {
    this.stop();
    clearHostedGame(this.code);
    this.events.setStatus('closed');
    this.events.clear();
  }

  // ─────────────────────────────────────────────────────────
  //  Canaux invités
  // ─────────────────────────────────────────────────────────

  private accept(connection: DataConnection): void {
    const id = connection.connectionId;

    connection.on('open', () => {
      this.connections.set(id, connection);
      this.host.connect(id);
    });

    connection.on('data', (raw) => {
      const message = parseClientMessage(raw);
      // Message qu'on ne comprend pas : on l'ignore en silence plutôt que de
      // fermer le canal. Un invité sur une version différente doit pouvoir
      // rester connecté le temps de rafraîchir.
      if (!message) return;

      void this.host.dispatch(id, message.event, message.payload).then((ack) => {
        this.send(connection, { t: 'res', id: message.id, ack });
      });
    });

    connection.on('close', () => this.drop(id));
    connection.on('error', () => this.drop(id));
  }

  private drop(id: string): void {
    if (!this.connections.delete(id)) return;
    void this.host.disconnect(id, 'canal fermé').then(() => this.schedulePersist());
  }

  /** Route un message sortant du moteur vers le bon canal. */
  private deliver(connectionId: string, event: string, payload: unknown): void {
    if (event === SERVER_EVENTS.stateUpdate) this.schedulePersist();

    if (connectionId === LOCAL) {
      this.events.dispatch(event, payload);
      return;
    }

    const connection = this.connections.get(connectionId);
    if (connection) this.send(connection, { t: 'evt', event, payload });
  }

  private send(connection: DataConnection, message: HostMessage): void {
    try {
      connection.send(message);
    } catch {
      // Canal fermé entre-temps : la fermeture arrivera par son propre
      // événement, il n'y a rien à faire de plus ici.
    }
  }

  private onPeerError(error: { type?: string }): void {
    // `peer-unavailable` signale qu'un invité a cherché un identifiant absent :
    // ça ne concerne pas notre partie et ne doit pas la faire basculer hors ligne.
    if (error.type === 'peer-unavailable') return;
    this.events.setStatus('offline');
  }

  // ─────────────────────────────────────────────────────────
  //  Sauvegarde et rattrapage
  // ─────────────────────────────────────────────────────────

  /**
   * Groupe les écritures.
   *
   * Une manche produit une diffusion par joueur et par changement : écrire à
   * chaque fois ferait plusieurs dizaines de sérialisations par seconde pendant
   * la révélation des résultats, sur le téléphone qui a déjà le plus à faire.
   */
  private schedulePersist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, 400);
  }

  private persistNow(): void {
    void this.host.store.get(this.code).then((game) => {
      if (game) saveHostedGame(game);
    });
  }

  private startTicking(): void {
    this.tickTimer = setInterval(() => void this.host.tickAll(), TICK_INTERVAL_MS);
  }

  /**
   * Réveil au retour au premier plan.
   *
   * C'est le moment critique : le téléphone de l'hôte vient de passer plusieurs
   * minutes verrouillé, ses minuteurs sont en retard, et les autres joueurs
   * attendent devant un décompte à zéro. `tickAll` rattrape toutes les
   * échéances d'un coup.
   */
  private watchWindow(): void {
    if (typeof window === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.host.tickAll();
    };
    const onHide = () => this.persistNow();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onHide);

    this.detachWindow = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onHide);
    };
  }

  private stop(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.saveTimer = null;
    this.tickTimer = null;

    this.detachWindow?.();
    this.detachWindow = null;

    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();

    this.host.close();
    this.peer.destroy();
  }
}

/**
 * Réserve un identifiant en insistant.
 *
 * Après la fermeture d'un onglet, le courtier met quelques secondes à libérer
 * l'identifiant. Sans ces tentatives, rafraîchir la page de l'hôte échouerait
 * une fois sur deux — et perdrait la partie.
 */
async function claimWithRetry(peerId: string, attempts = 5): Promise<Peer> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await openPeer(peerId);
    } catch (error) {
      lastError = error;
      if (!(error instanceof PeerUnavailableError)) throw error;
      await delay(600 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Identifiant indisponible.');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
