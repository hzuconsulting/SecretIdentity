'use client';

import { io, type Socket } from 'socket.io-client';
import { CLIENT_EVENTS, type Ack, type PongPayload } from '@identite-secrete/shared';
import { SERVER_URL } from './config';

/**
 * Socket unique pour toute l'application.
 *
 * On la crée paresseusement : le module est importé par des composants client
 * qui peuvent être rendus côté serveur au premier passage.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4_000,
    });
  }
  return socket;
}

/**
 * Mesure le décalage d'horloge client/serveur.
 *
 * `phaseEndsAt` est un timestamp **serveur**. Sans cette correction, un
 * téléphone dont l'horloge avance de 40 s afficherait un décompte faux.
 * On ne fait que corriger l'affichage : la fin d'une phase reste décidée
 * par le serveur (§4.2).
 *
 * @returns le décalage en ms à **ajouter** à `Date.now()` local pour obtenir
 *          l'heure serveur.
 */
export async function measureClockOffset(target: Socket): Promise<number> {
  const clientTime = Date.now();

  const pong = await new Promise<PongPayload>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Pas de réponse du serveur')), 5_000);

    target.emit(CLIENT_EVENTS.ping, { clientTime }, (payload: PongPayload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  const roundTrip = Date.now() - pong.clientTime;
  // On suppose l'aller et le retour symétriques.
  return pong.serverTime + roundTrip / 2 - Date.now();
}

/**
 * Émission avec acquittement typé.
 *
 * Socket.IO met les émissions en file d'attente tant que la connexion n'est
 * pas établie, mais il n'y a aucun délai d'expiration par défaut : sans le
 * `setTimeout` ci-dessous, un serveur éteint laisserait le bouton tourner
 * indéfiniment. On préfère une erreur typée que l'interface sait afficher.
 */
export function emitWithAck<T>(
  target: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 8_000,
): Promise<Ack<T>> {
  return new Promise<Ack<T>>((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Le serveur ne répond pas. Vérifie ta connexion et réessaie.',
        },
      });
    }, timeoutMs);

    target.emit(event, payload, (response: Ack<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(response);
    });
  });
}
