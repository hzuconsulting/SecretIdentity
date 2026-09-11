'use client';

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { gameError, type Ack } from '@identite-secrete/shared';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  HOST_GONE_MS,
  REQUEST_TIMEOUT_MS,
  peerIdForCode,
} from '@/lib/config';
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

/** Nombre d'échecs consécutifs avant de seulement envisager que l'hôte soit parti. */
const HOST_GONE_ATTEMPTS = 5;

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
  /** Dernier message reçu de l'hôte, battements compris. */
  private lastSeen = 0;
  /** Instant de la perte du canal, ou `null` tant qu'il tient. */
  private lostAt: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
   * Deux attentes contradictoires, d'où le drapeau `persistent`.
   *
   * Quelqu'un qui **tape un code** veut savoir tout de suite s'il s'est trompé :
   * l'échec du premier appel est le remplaçant exact du `GAME_NOT_FOUND` que
   * renvoyait le serveur, et il doit remonter.
   *
   * Quelqu'un qui **revient dans sa partie** — rechargement, onglet restauré,
   * réseau retrouvé — ne veut surtout pas lire « cette partie n'existe pas »
   * parce que l'hôte rafraîchissait sa page au même instant. Pour lui on rend
   * un nœud hors ligne dont l'échelle de reconnexion tourne déjà : c'est
   * exactement le traitement qu'aurait reçu une coupure survenue une seconde
   * plus tard.
   */
  static async connect(code: string, options: { persistent?: boolean } = {}): Promise<GuestNode> {
    const peer = await openPeer();
    const node = new GuestNode(code, peer);

    try {
      await node.dial();
    } catch (cause) {
      if (!options.persistent) {
        node.close();
        throw cause;
      }

      node.onLost();
    }

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

    this.stopHeartbeat();
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
        this.lostAt = null;
        this.lastSeen = Date.now();
        this.startHeartbeat();
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

    // Tout ce qui arrive prouve que le canal porte encore.
    this.lastSeen = Date.now();

    if (message.t === 'pong') return;

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

    this.stopHeartbeat();
    this.connection = null;
    this.lostAt ??= Date.now();

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
        // L'hôte n'est pas encore revenu. Passé un certain point, on le dit
        // franchement plutôt que de laisser tourner un sablier : il a
        // probablement fermé son onglet.
        if (this.hostLikelyGone()) this.events.setStatus('host-gone');
        this.scheduleRetry();
      });
    }, delay);
  }

  private onPeerError(error: { type?: string }): void {
    if (this.closed) return;

    // L'hôte n'est pas (ou plus) enregistré auprès du courtier. Ça arrive aussi
    // — et c'est le cas fréquent — pendant les quelques secondes où il
    // rafraîchit sa page : `hostLikelyGone` exige d'avoir attendu assez
    // longtemps pour ne pas confondre les deux.
    if (error.type === 'peer-unavailable') {
      this.events.setStatus(this.hostLikelyGone() ? 'host-gone' : 'offline');
      return;
    }

    this.events.setStatus('offline');
  }

  /**
   * L'hôte est-il vraiment parti, ou seulement en train de revenir ?
   *
   * La question n'a l'air de rien, mais s'y tromper coûte cher dans les deux
   * sens. Trop tôt, on annonce « la partie est finie » à des joueurs dont
   * l'hôte rafraîchissait sa page — il lui faut le temps de recharger, puis de
   * reprendre son identifiant auprès du courtier, ce qui se compte en secondes.
   * Trop tard, sept personnes regardent un sablier alors que le huitième a
   * fermé son onglet depuis une minute.
   *
   * D'où les deux conditions : une série d'échecs **et** une durée. Le nombre
   * seul ne dit rien, puisque les premiers reculs sont très courts.
   */
  private hostLikelyGone(): boolean {
    if (this.retry < HOST_GONE_ATTEMPTS) return false;
    return this.lostAt !== null && Date.now() - this.lostAt >= HOST_GONE_MS;
  }

  /**
   * Surveille le silence de l'hôte.
   *
   * Le cas traité ici n'est pas la coupure franche — elle déclenche `close` —
   * mais le canal **à moitié ouvert** : le navigateur le croit vivant, nos
   * messages partent sans erreur, et rien ne revient jamais. L'écran restait
   * alors sur « connecté » pendant que la partie avançait sans nous.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const connection = this.connection;
      if (!connection || !connection.open) return;

      if (Date.now() - this.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        // Muet depuis trop longtemps : on referme nous-mêmes, ce qui remet la
        // reconnexion sur le chemin ordinaire.
        recordAttempt({
          role: 'invité',
          code: this.code,
          outcome: 'échec',
          detail: 'hôte muet, canal refermé',
        });
        connection.close();
        this.onLost();
        return;
      }

      try {
        connection.send(encodeMessage({ t: 'ping', at: Date.now() }));
      } catch {
        // Canal refermé entre-temps : sa fermeture arrivera par son propre
        // événement, il n'y a rien à faire de plus ici.
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * Retenter tout de suite au retour au premier plan ou du réseau.
   *
   * `online` compte autant que `visibilitychange` : un téléphone qui repasse du
   * tunnel à la 4G garde son onglet au premier plan, donc aucun changement de
   * visibilité ne survient — on attendrait le recul suivant, jusqu'à douze
   * secondes, pour rien.
   */
  private watchWindow(): void {
    if (typeof window === 'undefined') return;

    const retryNow = () => {
      if (this.closed || this.connection?.open) return;

      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      this.retry = 0;
      this.dial().catch(() => this.scheduleRetry());
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      retryNow();
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', retryNow);

    this.detachWindow = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', retryNow);
    };
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
