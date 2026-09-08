import type { Ack } from '@identite-secrete/shared';

/**
 * Le seul contrat entre le moteur et le monde extérieur.
 *
 * Le moteur ne connaît ni Socket.IO, ni WebRTC, ni React : il sait seulement
 * pousser un message vers une connexion identifiée. C'est ce qui lui permet de
 * tourner à l'identique dans le navigateur de l'hôte, dans un test en mémoire,
 * ou un jour derrière un vrai serveur.
 */
export interface Emitter {
  /** Pousse un message vers **une** connexion. Une connexion morte est ignorée. */
  emit(connectionId: string, event: string, payload: unknown): void;
}

/** Identifiant de connexion. Opaque pour le moteur. */
export type ConnectionId = string;

/** Signature commune à tous les gestionnaires d'événement client. */
export type Handler = (payload: unknown) => Promise<Ack<unknown>>;
