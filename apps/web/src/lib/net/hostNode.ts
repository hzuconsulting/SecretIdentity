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
  type RelaySnapshot,
  type SessionPayload,
} from '@identite-secrete/shared';
import {
  GUEST_SILENCE_TIMEOUT_MS,
  peerIdForCode,
} from '@/lib/config';
import { NodeEvents, type GameNode, type NodeStatus, type StatusHandler } from './node';
import { PeerUnavailableError, openPeer } from './peer';
import { clearHostedGame, loadHostedGame, saveHostedGame } from './hostStorage';
import { encodeMessage, parseClientMessage, type HostMessage } from './protocol';
import { watchIce } from './iceInfo';
import { recordAttempt } from './connectionLog';
import { keepScreenAwake } from './wakeLock';

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

/**
 * Reculs entre deux tentatives de reprise de l'identifiant de signalisation.
 *
 * Un pair détruit par une erreur réseau ne se répare pas : il faut en rouvrir
 * un, sous le même identifiant. Sans cette échelle, une coupure de quelques
 * secondes chez l'hôte mettait fin à la partie — plus personne ne pouvait le
 * joindre, et lui-même ne s'en apercevait pas.
 *
 * La série couvre un peu plus de deux minutes, soit le temps d'un tunnel ou
 * d'un passage du Wi-Fi à la 4G.
 */
const RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

/**
 * Regroupement des diffusions d'instantané.
 *
 * Une manche produit plusieurs diffusions d'état par seconde. L'instantané, lui,
 * ne change réellement qu'à des moments rares — une manche se règle, quelqu'un
 * arrive ou part. Le regrouper évite d'envoyer une vingtaine de kilo-octets à
 * chaque joueur pour rien.
 *
 * Le plancher est ce qui compte le plus : il garantit qu'aucune rafale
 * d'événements ne peut transformer l'instantané en flux.
 */
const RELAY_DEBOUNCE_MS = 2_000;
const RELAY_MIN_INTERVAL_MS = 5_000;

export class HostNode implements GameNode {
  readonly hosting = true;

  private readonly events = new NodeEvents();
  private readonly connections = new Map<string, DataConnection>();
  /** Dernier signe de vie de chaque invité, battements compris. */
  private readonly lastSeen = new Map<string, number>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private detachWindow: (() => void) | null = null;
  private releaseScreen: (() => void) | null = null;
  private recovering = false;

  private relayTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRelayAt = 0;

  private constructor(
    readonly code: string,
    private peer: Peer,
    private readonly host: GameHost,
  ) {
    this.host.setEmitListener((connectionId, event, payload) => {
      this.deliver(connectionId, event, payload);
    });

    this.wirePeer();

    this.events.setStatus('online');
    this.startTicking();
    this.watchWindow();
    // L'écran de l'hôte doit rester allumé : c'est lui qui fait tourner la partie.
    this.releaseScreen = keepScreenAwake();
  }

  /**
   * Branche les écouteurs sur le pair courant.
   *
   * Séparé du constructeur parce que le pair n'est plus immuable : une erreur
   * fatale le détruit, et on en rouvre alors un autre sous le même identifiant
   * — qu'il faut rebrancher à l'identique (voir `recoverPeer`).
   */
  private wirePeer(): void {
    const peer = this.peer;

    peer.on('connection', (connection) => this.accept(connection));
    peer.on('error', (error) => this.onPeerError(error));
    peer.on('disconnected', () => {
      // Le canal de signalisation est tombé : les parties WebRTC déjà ouvertes
      // continuent, mais plus personne ne peut nous rejoindre. On se réenregistre.
      if (!peer.destroyed) peer.reconnect();
    });
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

  /**
   * Reprend une partie dont l'hôte a disparu.
   *
   * L'ordre est celui qui limite les dégâts d'un échec à mi-chemin :
   *
   * 1. **réserver l'identifiant d'abord**. Tant qu'il n'est pas à nous, rien
   *    n'a eu lieu : si un autre joueur nous a devancés, on échoue proprement
   *    et on repart en invité, sans avoir touché à quoi que ce soit.
   * 2. **construire le moteur ensuite**, ce qui incrémente la génération.
   * 3. **sauvegarder enfin**, pour que la partie survive à un rechargement de
   *    notre propre onglet dans la foulée.
   *
   * Deux tentatives seulement pour la réservation, là où un rafraîchissement
   * de page en utilise cinq : s'il est pris, c'est qu'un autre joueur héberge
   * désormais, et insister couperait la partie en deux.
   */
  static async adopt(
    snapshot: RelaySnapshot,
    selfPlayerId?: string,
  ): Promise<HostNode> {
    const peer = await claimWithRetry(peerIdForCode(snapshot.code), 2);

    let host: GameHost;
    try {
      host = await GameHost.adopt(snapshot, {
        ...(selfPlayerId ? { selfPlayerId } : {}),
      });
    } catch (cause) {
      // Le moteur n'a pas pu être reconstruit : on rend l'identifiant plutôt
      // que de le retenir en servant une partie qui n'existe pas.
      peer.destroy();
      throw cause;
    }

    const node = new HostNode(snapshot.code, peer, host);
    node.persistNow();

    recordAttempt({
      role: 'hôte',
      code: snapshot.code,
      outcome: 'réussi',
      detail: `partie reprise (génération ${snapshot.epoch + 1})`,
    });

    return node;
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
    const ice = watchIce(connection);

    connection.on('open', () => {
      this.connections.set(id, connection);
      this.lastSeen.set(id, Date.now());
      this.host.connect(id);
      recordAttempt({
        role: 'hôte',
        code: this.code,
        outcome: 'réussi',
        detail: `invité accepté · ${ice.describe()}`,
      });
      ice.stop();
    });

    connection.on('data', (raw) => {
      const message = parseClientMessage(raw);
      // Message qu'on ne comprend pas : on l'ignore en silence plutôt que de
      // fermer le canal. Un invité sur une version différente doit pouvoir
      // rester connecté le temps de rafraîchir.
      if (!message) return;

      // Tout ce qui arrive vaut signe de vie, battement ou action.
      this.lastSeen.set(id, Date.now());

      if (message.t === 'ping') {
        this.send(connection, { t: 'pong', at: message.at });
        return;
      }

      void this.host.dispatch(id, message.event, message.payload).then((ack) => {
        this.send(connection, { t: 'res', id: message.id, ack });
      });
    });

    connection.on('close', () => this.drop(id));
    connection.on('error', () => this.drop(id));
  }

  private drop(id: string): void {
    this.lastSeen.delete(id);
    if (!this.connections.delete(id)) return;
    void this.host.disconnect(id, 'canal fermé').then(() => this.schedulePersist());
  }

  /**
   * Ferme les canaux devenus muets.
   *
   * Un canal WebRTC ne signale pas toujours sa mort : il arrive qu'il reste
   * « ouvert » du point de vue du navigateur alors que plus rien ne circule.
   * Sans ce balayage, l'hôte gardait indéfiniment un joueur fantôme comme
   * connecté — la partie l'attendait pour changer de phase, et le moteur ne
   * déclenchait jamais sa période de grâce.
   *
   * On se contente de fermer le canal : le reste du chemin est celui d'une
   * déconnexion ordinaire, période de grâce du moteur comprise.
   */
  private sweepSilent(now: number): void {
    for (const [id, seen] of this.lastSeen) {
      if (now - seen <= GUEST_SILENCE_TIMEOUT_MS) continue;

      const connection = this.connections.get(id);
      recordAttempt({
        role: 'hôte',
        code: this.code,
        outcome: 'échec',
        detail: `invité muet depuis ${Math.round((now - seen) / 1_000)} s`,
      });

      // `close` déclenche l'écouteur posé dans `accept`, donc `drop`. Si le
      // canal a déjà disparu, on nettoie nous-mêmes.
      if (connection) connection.close();
      else this.drop(id);
    }
  }

  /** Route un message sortant du moteur vers le bon canal. */
  private deliver(connectionId: string, event: string, payload: unknown): void {
    if (event === SERVER_EVENTS.stateUpdate) {
      this.schedulePersist();
      this.scheduleRelay();
    }

    if (connectionId === LOCAL) {
      this.events.dispatch(event, payload);
      return;
    }

    const connection = this.connections.get(connectionId);
    if (connection) this.send(connection, { t: 'evt', event, payload });
  }

  private send(connection: DataConnection, message: HostMessage): void {
    try {
      connection.send(encodeMessage(message));
    } catch (cause) {
      // Deux cas sans gravité pour la partie : le canal s'est fermé entre-temps
      // — sa fermeture arrivera par son propre événement — ou le message
      // dépassait le plafond, ce qui doit se voir dans la console plutôt que de
      // disparaître.
      console.warn('Envoi impossible sur le canal invité', cause);
    }
  }

  private onPeerError(error: { type?: string }): void {
    // `peer-unavailable` signale qu'un invité a cherché un identifiant absent :
    // ça ne concerne pas notre partie et ne doit pas la faire basculer hors ligne.
    if (error.type === 'peer-unavailable') return;

    this.events.setStatus('offline');
    void this.recoverPeer();
  }

  /**
   * Rouvre un pair sous le même identifiant, après une erreur fatale.
   *
   * PeerJS détruit le pair sur ce genre d'erreur, et un pair détruit ne se
   * répare pas : `reconnect()` n'y peut rien. Sans cette reprise, une coupure
   * réseau de quelques secondes chez l'hôte rendait la partie définitivement
   * injoignable — les canaux déjà ouverts survivaient parfois, mais plus
   * personne ne pouvait revenir, et l'hôte n'avait aucun moyen de s'en rendre
   * compte.
   *
   * L'identifiant étant le code de la partie, le reprendre suffit : les invités
   * recomposent le même numéro et retombent sur nous.
   */
  private async recoverPeer(): Promise<void> {
    if (this.recovering) return;
    this.recovering = true;

    try {
      for (const wait of RECOVERY_DELAYS_MS) {
        await delay(wait);
        if (this.events.status === 'closed') return;
        // Un retour au premier plan a pu rétablir le pair entre-temps.
        if (!this.peer.destroyed && this.peer.open) {
          this.events.setStatus('online');
          return;
        }

        try {
          // Deux tentatives seulement : s'il est pris, c'est qu'un autre nœud
          // héberge désormais la partie, et insister la casserait en deux.
          const peer = await claimWithRetry(peerIdForCode(this.code), 2);
          this.adoptPeer(peer);
          return;
        } catch {
          // Courtier injoignable ou identifiant pris : on attend le recul suivant.
        }
      }

      recordAttempt({
        role: 'hôte',
        code: this.code,
        outcome: 'échec',
        detail: 'reprise de l’identifiant abandonnée',
      });
    } finally {
      this.recovering = false;
    }
  }

  /** Remplace le pair courant par un pair fraîchement réservé. */
  private adoptPeer(peer: Peer): void {
    const previous = this.peer;
    this.peer = peer;
    this.wirePeer();

    if (!previous.destroyed) previous.destroy();

    // Les canaux de l'ancien pair sont morts avec lui. On les oublie pour que
    // le moteur ouvre leur période de grâce ; les invités redemandent le code.
    for (const id of [...this.connections.keys()]) this.drop(id);

    this.events.setStatus('online');
    recordAttempt({
      role: 'hôte',
      code: this.code,
      outcome: 'réussi',
      detail: 'identifiant repris après coupure',
    });
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

  /**
   * Programme la diffusion de l'instantané de reprise.
   *
   * Branché sur le même signal que la sauvegarde — toute diffusion d'état —
   * mais avec une cadence bien plus lâche, pour deux raisons : l'instantané
   * pèse mille fois plus qu'une vue, et son contenu ne change qu'à des moments
   * rares. En pratique on en observe une poignée sur une partie entière, pas un
   * flux.
   *
   * Le plancher garantit qu'aucune rafale — la révélation des résultats, par
   * exemple — ne peut le transformer en flux.
   */
  private scheduleRelay(): void {
    if (this.relayTimer) return;

    const sinceLast = Date.now() - this.lastRelayAt;
    const wait = Math.max(RELAY_DEBOUNCE_MS, RELAY_MIN_INTERVAL_MS - sinceLast);

    this.relayTimer = setTimeout(() => {
      this.relayTimer = null;
      void this.relayNow();
    }, wait);
  }

  /**
   * Construit et envoie l'instantané à tous les invités connectés.
   *
   * `LOCAL` est exclu de la file de succession : elle répond à « qui reprend si
   * **je** disparais », et l'hôte ne peut pas être son propre successeur. Le
   * moteur ne sait pas lequel des joueurs est local — `game.hostId` désigne
   * l'hôte du salon, pas celui du moteur — donc c'est ici qu'on le lui dit.
   */
  private async relayNow(): Promise<void> {
    if (this.events.status === 'closed') return;
    this.lastRelayAt = Date.now();

    try {
      await this.host.relay(this.code, LOCAL);
    } catch (cause) {
      // `crypto.subtle` absent (contexte non sécurisé), ou instantané
      // impossible à construire. La partie continue : on perd seulement la
      // possibilité qu'un autre joueur la reprenne.
      console.warn('Instantané de reprise impossible', cause);
    }
  }

  private startTicking(): void {
    this.tickTimer = setInterval(() => {
      this.sweepSilent(Date.now());
      void this.host.tickAll();
    }, TICK_INTERVAL_MS);
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
    if (this.relayTimer) clearTimeout(this.relayTimer);
    this.saveTimer = null;
    this.tickTimer = null;
    this.relayTimer = null;

    this.detachWindow?.();
    this.detachWindow = null;

    this.releaseScreen?.();
    this.releaseScreen = null;

    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
    this.lastSeen.clear();

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
