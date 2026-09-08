'use client';

import type { DataConnection } from 'peerjs';

/**
 * Ce qu'on sait dire d'une négociation ICE.
 *
 * Partagé entre l'auto-test et les vraies tentatives de connexion, parce que
 * c'est exactement la même information qu'on veut dans les deux cas — et parce
 * qu'un diagnostic qui ne décrit pas la panne réelle ne sert à rien.
 *
 * Les types de candidats sont ce qui a le plus de valeur :
 *  - pas de `srflx` → aucun serveur STUN n'a répondu ;
 *  - `host` seul → on ne connaît que des adresses locales ;
 *  - `relay` → un TURN a alloué, la connexion aboutira presque toujours.
 */

export interface IceWatcher {
  /** Types de candidats obtenus jusqu'ici. */
  types: Set<string>;
  /** Résumé lisible : états ICE et candidats. */
  describe(): string;
  stop(): void;
}

export function watchIce(connection: DataConnection): IceWatcher {
  const types = new Set<string>();
  let pc: RTCPeerConnection | undefined;
  let listener: ((event: RTCPeerConnectionIceEvent) => void) | null = null;

  // `peerConnection` existe dès la construction du négociateur, mais ce n'est
  // pas une API que PeerJS s'engage à garder : sans elle le diagnostic reste
  // utile, simplement moins précis.
  try {
    pc = connection.peerConnection;
    listener = (event) => {
      if (event.candidate?.type) types.add(event.candidate.type);
    };
    pc?.addEventListener('icecandidate', listener);
  } catch {
    pc = undefined;
  }

  return {
    types,

    describe(): string {
      const candidats = types.size > 0 ? [...types].sort().join('+') : 'aucun';
      const current = safePeerConnection(connection) ?? pc;

      if (!current) return `candidats ${candidats}`;
      return `ICE ${current.iceConnectionState}/${current.iceGatheringState} · candidats ${candidats}`;
    },

    stop(): void {
      if (pc && listener) pc.removeEventListener('icecandidate', listener);
      listener = null;
    },
  };
}

function safePeerConnection(connection: DataConnection): RTCPeerConnection | undefined {
  try {
    return connection.peerConnection;
  } catch {
    return undefined;
  }
}
