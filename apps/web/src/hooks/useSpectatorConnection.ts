'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  gameError,
  type GameError,
  type SpectatorView,
} from '@identite-secrete/shared';
import { getNode, type GameNode, type NodeStatus } from '@/lib/net';

/**
 * Suivi d'une partie sans y jouer.
 *
 * Le pendant de `useGameConnection`, en beaucoup plus court, et la brièveté est
 * l'essentiel : il n'y a **aucune action à émettre**. Un écran de suivi ouvre
 * un canal, se déclare spectateur, et affiche ce qui arrive. Pas de session à
 * reprendre, pas de pseudo à choisir, pas de place à défendre — il n'en a pas.
 *
 * Le nœud sous-jacent est celui de tout le monde (`getNode`) : mêmes
 * reconnexions, même reprise d'identifiant quand l'hôte rafraîchit sa page.
 * Comme cet appareil n'a pas de session sur la partie, la surveillance de
 * reprise d'hébergement ne s'arme pas : une télé ne reprendra jamais la partie
 * à son compte, ce qui serait le contraire de ce qu'on lui demande.
 */

export type SpectatorStatus =
  /** Canal en cours d'ouverture. */
  | 'connecting'
  /** Vue reçue : l'écran affiche la partie. */
  | 'watching'
  /** Canal rompu, reconnexion automatique en cours. */
  | 'lost'
  /** L'hôte a fermé son onglet : la partie ne reviendra pas. */
  | 'host-gone'
  /** Refusé — code inconnu, ou trop d'écrans déjà branchés. Rien à retenter. */
  | 'refused';

export interface SpectatorConnection {
  status: SpectatorStatus;
  view: SpectatorView | null;
  error: GameError | null;
}

export function useSpectatorConnection(code: string): SpectatorConnection {
  const [node, setNode] = useState<GameNode | null>(null);
  const [status, setStatus] = useState<SpectatorStatus>('connecting');
  const [view, setView] = useState<SpectatorView | null>(null);
  const [error, setError] = useState<GameError | null>(null);

  /**
   * La génération d'hébergement la plus avancée reçue.
   *
   * Même garde que pour les joueurs (D-74) : si deux nœuds croient héberger la
   * partie, la télé afficherait sinon un score qui remonte le temps sous les
   * yeux de toute la pièce.
   */
  const epoch = useRef(-1);

  // ───────────────────────────────────────────────────────────
  //  Ouverture du canal
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    getNode(code)
      .then((opened) => {
        if (!cancelled) setNode(opened);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          gameError('GAME_NOT_FOUND', {
            message:
              cause instanceof Error && cause.message
                ? cause.message
                : "Aucune partie ouverte sous ce code.",
          }),
        );
        setStatus('refused');
      });

    // Le nœud n'est pas fermé au démontage, comme pour un joueur : il est un
    // singleton de module et survit à la navigation.
    return () => {
      cancelled = true;
    };
  }, [code]);

  // ───────────────────────────────────────────────────────────
  //  Abonnements
  // ───────────────────────────────────────────────────────────

  const watch = useCallback(
    async (target: GameNode): Promise<void> => {
      const ack = await target.emit<null>(CLIENT_EVENTS.spectate, { code });
      if (ack.ok) {
        setError(null);
        return;
      }

      // Un refus du moteur est définitif ; un échec de canal ne l'est pas — il
      // sera rejoué à la réouverture, par l'événement `connect`.
      if (ack.error.code === 'GAME_NOT_FOUND' || ack.error.code === 'SPECTATORS_FULL') {
        setError(ack.error);
        setStatus('refused');
      }
    },
    [code],
  );

  useEffect(() => {
    if (!node) return;

    const handleView = (incoming: SpectatorView) => {
      if (incoming.epoch < epoch.current) return;
      epoch.current = incoming.epoch;
      setView(incoming);
      setStatus('watching');
    };

    const handleConnect = () => void watch(node);

    const handleNodeStatus = (nodeStatus: NodeStatus) => {
      setStatus((current) => {
        if (current === 'refused') return current;
        if (nodeStatus === 'offline') return 'lost';
        if (nodeStatus === 'host-gone') return 'host-gone';
        return current;
      });
    };

    node.on(SERVER_EVENTS.spectatorUpdate, handleView);
    node.on('connect', handleConnect);
    const unsubscribe = node.onStatus(handleNodeStatus);

    // Le canal est déjà ouvert : on se déclare tout de suite, sans attendre un
    // `connect` qui n'aura pas lieu.
    if (node.status === 'online') void watch(node);

    return () => {
      node.off(SERVER_EVENTS.spectatorUpdate, handleView);
      node.off('connect', handleConnect);
      unsubscribe();
    };
  }, [node, watch]);

  return { status, view, error };
}
