import type { Ack } from '@identite-secrete/shared';

/**
 * Le format des messages qui circulent sur un canal WebRTC.
 *
 * Il tient en trois formes, et c'est voulu : plus le protocole est petit, moins
 * il y a de surface à valider. Or il **faut** tout valider — le nœud hôte reçoit
 * des octets envoyés par des navigateurs qu'il ne contrôle pas, exactement
 * comme le serveur d'avant recevait des payloads arbitraires.
 *
 * Le corrélateur `id` est propre à chaque canal : deux invités peuvent utiliser
 * le même numéro sans se marcher dessus, puisque chacun a sa file.
 */

/** Invité → hôte : une action, à acquitter. */
export interface RequestMessage {
  t: 'req';
  id: number;
  event: string;
  payload: unknown;
}

/** Hôte → invité : l'acquittement d'une action. */
export interface ResponseMessage {
  t: 'res';
  id: number;
  ack: Ack<unknown>;
}

/** Hôte → invité : un message poussé (vue de jeu, changement de phase, toast). */
export interface EventMessage {
  t: 'evt';
  event: string;
  payload: unknown;
}

export type ClientMessage = RequestMessage;
export type HostMessage = ResponseMessage | EventMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Valide un message reçu par l'hôte.
 *
 * Ne vérifie que l'enveloppe : le contenu de `payload` est validé plus loin par
 * les schémas Zod du moteur, qui sont la vraie ligne de défense.
 */
export function parseClientMessage(value: unknown): RequestMessage | null {
  if (!isRecord(value)) return null;
  if (value.t !== 'req') return null;
  if (typeof value.id !== 'number' || !Number.isFinite(value.id)) return null;
  if (typeof value.event !== 'string' || value.event.length > 64) return null;

  return { t: 'req', id: value.id, event: value.event, payload: value.payload };
}

/** Valide un message reçu par un invité. */
export function parseHostMessage(value: unknown): HostMessage | null {
  if (!isRecord(value)) return null;

  if (value.t === 'res') {
    if (typeof value.id !== 'number' || !isRecord(value.ack)) return null;
    if (typeof value.ack.ok !== 'boolean') return null;
    return { t: 'res', id: value.id, ack: value.ack as unknown as Ack<unknown> };
  }

  if (value.t === 'evt') {
    if (typeof value.event !== 'string') return null;
    return { t: 'evt', event: value.event, payload: value.payload };
  }

  return null;
}
