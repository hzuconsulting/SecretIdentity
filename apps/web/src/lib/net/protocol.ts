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
 *
 * ─── Pourquoi on sérialise nous-mêmes ───
 *
 * PeerJS sait le faire, mais aucun de ses modes ne convient : `binary` (son
 * défaut) et `json` envoient tous deux un `Uint8Array` sur le canal de données.
 * Or **Safari ne parvient pas à émettre de binaire** par ce chemin — il le
 * reçoit, mais ses propres envois n'arrivent jamais. Un iPhone se connectait
 * donc sans jamais pouvoir parler, dans les deux rôles.
 *
 * Le mode `raw` de PeerJS transmet la valeur telle quelle : en lui donnant une
 * chaîne, c'est une chaîne qui part, et Safari s'en accommode. La contrepartie
 * est qu'il n'y a plus de découpage automatique, d'où la garde de taille.
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

/**
 * Plafond de taille d'un message.
 *
 * Le mode `raw` ne découpe pas : un message trop gros ferait échouer
 * `RTCDataChannel.send`, et PeerJS **ferme le canal** sur cette erreur. Mieux
 * vaut refuser l'envoi bruyamment que perdre la connexion d'un joueur.
 *
 * L'ordre de grandeur réel est très en dessous : une vue de jeu à huit joueurs
 * pèse quelques kilo-octets. Ce plafond n'est là que pour transformer un bug
 * futur en message d'erreur plutôt qu'en déconnexion inexpliquée.
 */
const MAX_MESSAGE_BYTES = 60_000;

export class MessageTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`Message de ${size} octets, au-delà du plafond de ${MAX_MESSAGE_BYTES}.`);
    this.name = 'MessageTooLargeError';
  }
}

/** Encode un message en chaîne, prêt pour un canal PeerJS en mode `raw`. */
export function encodeMessage(message: ClientMessage | HostMessage): string {
  const encoded = JSON.stringify(message);

  // `length` compte des unités UTF-16 ; les emoji en valent deux. On reste donc
  // conservateur par rapport aux octets réellement émis, ce qui convient pour
  // une garde.
  if (encoded.length > MAX_MESSAGE_BYTES) throw new MessageTooLargeError(encoded.length);

  return encoded;
}

/** Décode ce qui arrive du canal. `null` si ce n'est pas du JSON exploitable. */
function decode(value: unknown): unknown {
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Valide un message reçu par l'hôte.
 *
 * Ne vérifie que l'enveloppe : le contenu de `payload` est validé plus loin par
 * les schémas Zod du moteur, qui sont la vraie ligne de défense.
 */
export function parseClientMessage(raw: unknown): RequestMessage | null {
  const value = decode(raw);
  if (!isRecord(value)) return null;
  if (value.t !== 'req') return null;
  if (typeof value.id !== 'number' || !Number.isFinite(value.id)) return null;
  if (typeof value.event !== 'string' || value.event.length > 64) return null;

  return { t: 'req', id: value.id, event: value.event, payload: value.payload };
}

/** Valide un message reçu par un invité. */
export function parseHostMessage(raw: unknown): HostMessage | null {
  const value = decode(raw);
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
