'use client';

import type Peer from 'peerjs';
import type { PeerOptions } from 'peerjs';
import { ICE_SERVERS, SIGNALING } from '@/lib/config';

/**
 * Ouverture d'un pair.
 *
 * `peerjs` est importé dynamiquement, et jamais au niveau du module : le site
 * est exporté en statique, donc chaque page est rendue une fois au build, dans
 * Node, où il n'y a ni `window` ni `RTCPeerConnection`. Un import statique
 * ferait échouer le build avant même d'atteindre un navigateur.
 */

let peerModule: typeof import('peerjs') | null = null;

async function loadPeerJs(): Promise<typeof import('peerjs')> {
  peerModule ??= await import('peerjs');
  return peerModule;
}

function peerOptions(): PeerOptions {
  return {
    debug: 0,
    config: { iceServers: ICE_SERVERS },
    ...SIGNALING,
  };
}

export class PeerUnavailableError extends Error {
  constructor(readonly peerId: string) {
    super(`Identifiant déjà pris : ${peerId}`);
    this.name = 'PeerUnavailableError';
  }
}

export class SignalingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignalingError';
  }
}

/**
 * Ouvre un pair et attend qu'il soit enregistré auprès du service de
 * signalisation.
 *
 * Deux échecs sont distingués parce qu'ils appellent deux réactions
 * différentes : l'identifiant déjà pris veut dire « retente avec un autre
 * code », tout le reste veut dire « la signalisation ne répond pas ».
 */
export function openPeer(id?: string): Promise<Peer> {
  return loadPeerJs().then(
    ({ default: PeerConstructor }) =>
      new Promise<Peer>((resolve, reject) => {
        const peer = id
          ? new PeerConstructor(id, peerOptions())
          : new PeerConstructor(peerOptions());

        const timeout = setTimeout(() => {
          cleanup();
          peer.destroy();
          reject(new SignalingError('Le service de mise en relation ne répond pas.'));
        }, 15_000);

        function cleanup(): void {
          clearTimeout(timeout);
          peer.off('open', onOpen);
          peer.off('error', onError);
        }

        function onOpen(): void {
          cleanup();
          resolve(peer);
        }

        function onError(error: { type?: string; message?: string }): void {
          // `unavailable-id` est le seul cas récupérable : un autre onglet tient
          // déjà ce code. Les autres — réseau coupé, courtier injoignable — ne
          // se règlent pas en retentant un identifiant différent.
          const fatal = error.type !== 'unavailable-id';
          cleanup();
          peer.destroy();
          reject(
            fatal
              ? new SignalingError(error.message ?? 'Mise en relation impossible.')
              : new PeerUnavailableError(id ?? ''),
          );
        }

        peer.on('open', onOpen);
        peer.on('error', onError);
      }),
  );
}

/** `true` si le navigateur sait faire du WebRTC. */
export function supportsWebRtc(): boolean {
  return typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function';
}
