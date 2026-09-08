'use client';

import type { Ack } from '@identite-secrete/shared';

/**
 * Ce que l'interface voit du réseau.
 *
 * Les écrans ne savent pas — et ne doivent pas savoir — s'ils tournent sur le
 * téléphone qui héberge la partie ou sur celui d'un invité. Les deux nœuds
 * exposent la même chose : on émet une action, on reçoit un acquittement, on
 * s'abonne aux messages poussés. C'est ce qui a permis de remplacer Socket.IO
 * par du WebRTC sans réécrire un seul écran.
 */

export type NodeStatus =
  /** Canal en cours d'établissement. */
  | 'connecting'
  /** Canal ouvert : les actions passent. */
  | 'online'
  /** Canal rompu, reconnexion en cours. */
  | 'offline'
  /** L'hôte a quitté : la partie ne reviendra pas. */
  | 'host-gone'
  /** Nœud fermé volontairement. */
  | 'closed';

export type MessageHandler = (payload: never) => void;
export type StatusHandler = (status: NodeStatus) => void;

export interface GameNode {
  readonly code: string;
  /** `true` si le moteur de jeu tourne dans **cet** onglet. */
  readonly hosting: boolean;
  readonly status: NodeStatus;

  emit<T>(event: string, payload: unknown): Promise<Ack<T>>;
  on<T>(event: string, handler: (payload: T) => void): void;
  off<T>(event: string, handler: (payload: T) => void): void;
  onStatus(handler: StatusHandler): () => void;
  close(): void;
}

/** Bus d'événements minimal, partagé par les deux implémentations. */
export class NodeEvents {
  private readonly handlers = new Map<string, Set<MessageHandler>>();
  private readonly statusHandlers = new Set<StatusHandler>();
  private current: NodeStatus = 'connecting';

  get status(): NodeStatus {
    return this.current;
  }

  on<T>(event: string, handler: (payload: T) => void): void {
    const set = this.handlers.get(event) ?? new Set<MessageHandler>();
    set.add(handler as MessageHandler);
    this.handlers.set(event, set);
  }

  off<T>(event: string, handler: (payload: T) => void): void {
    this.handlers.get(event)?.delete(handler as MessageHandler);
  }

  dispatch(event: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      (handler as (value: unknown) => void)(payload);
    }
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    // L'abonné reçoit l'état courant tout de suite : sans ça, un composant monté
    // après l'ouverture du canal resterait bloqué sur « connexion… ».
    handler(this.current);
    return () => this.statusHandlers.delete(handler);
  }

  setStatus(status: NodeStatus): void {
    if (this.current === status) return;
    this.current = status;
    for (const handler of [...this.statusHandlers]) handler(status);
  }

  clear(): void {
    this.handlers.clear();
    this.statusHandlers.clear();
  }
}
