'use client';

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { gameError, type Ack } from '@identite-secrete/shared';
import { REQUEST_TIMEOUT_MS, peerIdForCode } from '@/lib/config';
import { NodeEvents, type GameNode, type NodeStatus, type StatusHandler } from './node';
import { openPeer } from './peer';
import { encodeMessage, parseHostMessage } from './protocol';
import { watchIce } from './iceInfo';
import { recordAttempt } from './connectionLog';

/**
 * Le nœud d'un joueur invité.
 *
 * Il ne décide de rien : il envoie des actions au téléphone qui héberge et
 * affiche les vues qu'il reçoit. C'est exactement le rôle qu'avait le client
 * Socket.IO, à ceci près que « le serveur » est maintenant un autre joueur.
 *
 * Toute la difficulté est dans la reconnexion. Un canal WebRTC tombe pour bien
 * moins qu'une socket : on passe du Wi-Fi à la 4G, l'écran se verrouille, la
 * page repasse au premier plan. On retente donc, avec un délai qui s'allonge,
 * et on ne déclare la partie perdue qu'après un long moment.
 */

/** Un canal rompu est retenté selon ces délais, en millisecondes. */
const RETRY_DELAYS_MS = [400, 800, 1_500, 3_000, 5_000, 8_000, 12_000];

export class GuestNode implements GameNode {
  readonly hosting = false;

  private readonly events = new NodeEvents();
  private readonly pending = new Map<
    number,
    { resolve: (ack: Ack<unknown>) => void; timer: ReturnType<typeof setTimeout> }
  >();

  private connection: DataConnection | null = null;
  private nextRequestId = 1;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private detachWindow: (() => void) | null = null;

  private constructor(
    readonly code: string,
    private readonly peer: Peer,
  ) {
    this.peer.on('error', (error) => this.onPeerError(error));
    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed && !this.closed) this.peer.reconnect();
    });
    this.watchWindow();
  }

  /**
   * Ouvre un canal vers l'hôte de la partie `code`.
   *
   * Échoue si personne n'héberge ce code : c'est le remplaçant exact du
   * `GAME_NOT_FOUND` que renvoyait le serveur, à ceci près que la réponse vient
   * du service de signalisation.
   */
  static async connect(code: string): Promise<GuestNode> {
    const peer = await openPeer();
    const node = new GuestNode(code, peer);

    await node.dial();
    return node;
  }

  // ─────────────────────────────────────────────────────────
  //  Interface GameNode
  // ─────────────────────────────────────────────────────────

  get status(): NodeStatus {
    return this.events.status;
  }

  /**
   * Envoie une action et attend son acquittement.
   *
   * Le délai d'expiration n'est pas un détail de confort : sans lui, un hôte qui
   * a fermé son onglet laisserait le bouton « Valider » tourner indéfiniment.
   * On préfère une erreur typée que l'interface sait afficher.
   */
  emit<T>(event: string, payload: unknown): Promise<Ack<T>> {
    const connection = this.connection;
    if (!connection || !connection.open) {
      return Promise.resolve(offline<T>());
    }

    const id = this.nextRequestId++;

    return new Promise<Ack<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(offline<T>());
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (ack: Ack<unknown>) => void,
        timer,
      });

      try {
        connection.send(encodeMessage({ t: 'req', id, event, payload }));
      } catch (cause) {
        console.warn('Envoi impossible vers l’hôte', cause);
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(offline<T>());
      }
    });
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

  close(): void {
    this.closed = true;

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;

    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();

    this.detachWindow?.();
    this.detachWindow = null;

    this.connection?.close();
    this.connection = null;
    this.peer.destroy();

    this.events.setStatus('closed');
    this.events.clear();
  }

  // ─────────────────────────────────────────────────────────
  //  Canal
  // ─────────────────────────────────────────────────────────

  private dial(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const connection = this.peer.connect(peerIdForCode(this.code), {
        reliable: true,
        // `raw` transmet la valeur telle quelle : on lui donne une chaîne, une
        // chaîne part sur le canal. Les modes `binary` et `json` de PeerJS
        // envoient tous deux un `Uint8Array`, que Safari ne parvient pas à
        // émettre — voir l'en-tête de `protocol.ts`.
        //
        // L'hôte reprend ce réglage depuis l'offre : il n'a rien à déclarer.
        serialization: 'raw',
      });

      // La négociation est observée pour elle-même : c'est la seule tentative
      // qui traverse un vrai réseau, donc la seule dont le verdict compte
      // vraiment. `/diagnostic` la relira après coup.
      const ice = watchIce(connection);
      let settled = false;

      const settle = (outcome: 'réussi' | 'échec', detail: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        recordAttempt({ role: 'invité', code: this.code, outcome, detail });
        ice.stop();
      };

      const timeout = setTimeout(() => {
        settle('échec', `délai dépassé · ${ice.describe()}`);
        connection.close();
        reject(new Error("L'hôte de la partie ne répond pas."));
      }, 15_000);

      connection.on('open', () => {
        settle('réussi', ice.describe());
        this.connection = connection;
        this.retry = 0;
        this.events.setStatus('online');
        // `connect` réveille l'interface, qui rejoue sa reprise de session.
        this.events.dispatch('connect', null);
        resolve();
      });

      connection.on('data', (raw) => this.receive(raw));
      connection.on('close', () => {
        settle('échec', `canal fermé · ${ice.describe()}`);
        this.onLost();
      });
      connection.on('error', (error) => {
        settle('échec', `${error.type ?? 'erreur'} · ${ice.describe()}`);
        this.onLost();
      });
    });
  }

  private receive(raw: unknown): void {
    const message = parseHostMessage(raw);
    if (!message) return;

    if (message.t === 'res') {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.id);
      waiting.resolve(message.ack);
      return;
    }

    this.events.dispatch(message.event, message.payload);
  }

  private onLost(): void {
    if (this.closed) return;

    this.connection = null;

    // Les actions en vol ne recevront jamais leur réponse : on les libère avec
    // une erreur plutôt que de laisser l'interface bloquée.
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.resolve(offline());
      this.pending.delete(id);
    }

    this.events.setStatus('offline');
    this.events.dispatch('disconnect', null);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.closed || this.retryTimer) return;

    const delay = RETRY_DELAYS_MS[Math.min(this.retry, RETRY_DELAYS_MS.length - 1)] ?? 12_000;
    this.retry += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed) return;

      this.dial().catch(() => {
        // L'hôte n'est pas encore revenu. Après une longue série d'échecs, on le
        // dit franchement : il a probablement fermé son onglet, et aucune
        // reconnexion ne le ramènera.
        if (this.retry > RETRY_DELAYS_MS.length) this.events.setStatus('host-gone');
        this.scheduleRetry();
      });
    }, delay);
  }

  private onPeerError(error: { type?: string }): void {
    if (this.closed) return;

    // L'hôte n'est pas (ou plus) enregistré auprès du courtier.
    if (error.type === 'peer-unavailable') {
      this.events.setStatus(this.retry > RETRY_DELAYS_MS.length ? 'host-gone' : 'offline');
      return;
    }

    this.events.setStatus('offline');
  }

  /** Retenter tout de suite au retour au premier plan, sans attendre le délai. */
  private watchWindow(): void {
    if (typeof window === 'undefined') return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.closed || this.connection?.open) return;

      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.retry = 0;
      this.dial().catch(() => this.scheduleRetry());
    };

    document.addEventListener('visibilitychange', onVisible);
    this.detachWindow = () => document.removeEventListener('visibilitychange', onVisible);
  }
}

/** L'erreur rendue quand le canal ne peut pas porter l'action. */
function offline<T>(): Ack<T> {
  return {
    ok: false,
    error: gameError('INTERNAL_ERROR', {
      message: "L'hôte de la partie ne répond pas. La reconnexion est automatique.",
    }),
  };
}
