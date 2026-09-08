'use client';

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { openPeer, supportsWebRtc } from './peer';
import { encodeMessage, parseClientMessage } from './protocol';

/**
 * Auto-test du transport.
 *
 * L'appareil ouvre deux pairs et se connecte à lui-même, puis fait passer un
 * vrai message par un vrai canal WebRTC — la même sérialisation que celle d'une
 * partie. Ce n'est pas un ping décoratif : ça exerce exactement le chemin qui
 * échoue en pratique.
 *
 * Ce qui a motivé cet ajout : sur iPhone, PeerJS ouvrait le canal puis Safari
 * n'arrivait pas à émettre. Aucun message d'erreur nulle part, deux joueurs qui
 * s'attendent, et rien pour distinguer « ton navigateur ne sait pas envoyer »
 * de « ton ami a fermé son onglet ». Ce test-là l'aurait dit en trois secondes.
 *
 * Ce qu'il **ne** prouve pas : que deux appareils distincts sauront s'atteindre.
 * La boucle locale ne traverse aucun NAT. Il couvre le navigateur et la mise en
 * relation, pas la topologie du réseau.
 */

export type SelfTestResult =
  /** Tout va bien : le canal s'ouvre et transporte les messages. */
  | 'ready'
  /** Navigateur sans WebRTC, ou page servie hors contexte sécurisé. */
  | 'no-webrtc'
  /** Le service de mise en relation ne répond pas. */
  | 'no-signaling'
  /** Le canal s'ouvre mais rien ne passe — le cas Safari décrit ci-dessus. */
  | 'no-datachannel';

const OPEN_TIMEOUT_MS = 12_000;

export async function runTransportSelfTest(): Promise<SelfTestResult> {
  if (!supportsWebRtc()) return 'no-webrtc';

  let peers: [Peer, Peer];
  try {
    peers = await Promise.all([openPeer(), openPeer()]);
  } catch {
    return 'no-signaling';
  }

  const [caller, receiver] = peers;

  try {
    return (await loopback(caller, receiver)) ? 'ready' : 'no-datachannel';
  } catch {
    return 'no-datachannel';
  } finally {
    caller.destroy();
    receiver.destroy();
  }
}

/** Envoie un message de l'un à l'autre et attend qu'il arrive intact. */
function loopback(caller: Peer, receiver: Peer): Promise<boolean> {
  const probe = `probe-${Date.now()}`;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout = setTimeout(() => finish(false), OPEN_TIMEOUT_MS);

    receiver.on('connection', (incoming: DataConnection) => {
      incoming.on('data', (raw) => {
        const message = parseClientMessage(raw);
        finish(message?.event === probe);
      });
    });

    const outgoing = caller.connect(receiver.id, {
      reliable: true,
      serialization: 'raw',
    });

    outgoing.on('open', () => {
      try {
        outgoing.send(encodeMessage({ t: 'req', id: 1, event: probe, payload: null }));
      } catch {
        finish(false);
      }
    });

    outgoing.on('error', () => finish(false));
  });
}
