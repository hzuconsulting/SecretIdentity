'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  gameError,
  type GameError,
  type PlacedPicto,
  type PlayerId,
  type PlayerView,
  type SessionPayload,
  type Settings,
  type Slot,
  type ToastPayload,
} from '@identite-secrete/shared';
import { closeCurrent, getNode, onNodeReplaced, type GameNode, type NodeStatus } from '@/lib/net';
import { clearSession, loadSession, saveSession } from '@/lib/session';

/**
 * Connexion à une partie.
 *
 * Le moteur est la seule source de vérité : ce hook ne calcule aucun état de
 * jeu, il se contente de stocker la dernière `PlayerView` reçue et d'émettre les
 * actions. Aucune mise à jour optimiste — un salon qui affiche un joueur que le
 * moteur ne connaît pas serait pire qu'une demi-seconde d'attente.
 *
 * Que le moteur tourne dans cet onglet (on héberge) ou dans celui d'un autre
 * joueur ne change rien ici : `getNode` rend la même interface des deux côtés.
 */

export type ConnectionStatus =
  | 'connecting'
  | 'restoring'
  | 'need-nickname'
  | 'joining'
  | 'connected'
  | 'lost'
  /** L'hôte a fermé son onglet : la partie ne reviendra pas. */
  | 'host-gone'
  /** L'hôte nous a exclu : il n'y a rien à retenter. */
  | 'kicked';

interface Toast extends ToastPayload {
  id: number;
}

export interface GameConnection {
  status: ConnectionStatus;
  view: PlayerView | null;
  error: GameError | null;
  toasts: Toast[];
  /** `true` si le moteur de la partie tourne dans cet onglet. */
  hosting: boolean;
  join: (nickname: string) => Promise<GameError | null>;
  startGame: () => Promise<GameError | null>;
  submitClues: (placed: PlacedPicto[]) => Promise<GameError | null>;
  submitVotes: (votes: Record<PlayerId, Slot>) => Promise<GameError | null>;
  replay: () => Promise<GameError | null>;
  nextRound: () => Promise<GameError | null>;
  updateSettings: (patch: Partial<Settings>) => Promise<GameError | null>;
  kickPlayer: (playerId: PlayerId) => Promise<GameError | null>;
  leave: () => Promise<void>;
  dismissError: () => void;
}

export function useGameConnection(code: string): GameConnection {
  const [node, setNode] = useState<GameNode | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Évite de relancer une reprise de session pendant qu'une autre est en cours.
  const rejoining = useRef(false);

  /**
   * La génération d'hébergement la plus avancée qu'on ait vue.
   *
   * Sert à écarter les vues d'un hôte périmé. Le cas est rare mais silencieux :
   * si le courtier laisse deux nœuds réserver le même identifiant — partition
   * réseau, ancien hôte qui revient — la partie se scinderait en deux sans le
   * moindre symptôme, chacun voyant un état cohérent mais différent.
   */
  const epoch = useRef(-1);

  const pushToast = useCallback((payload: ToastPayload) => {
    const toast: Toast = { ...payload, id: Date.now() + Math.random() };
    setToasts((current) => [...current, toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 4_000);
  }, []);

  // ───────────────────────────────────────────────────────────
  //  Ouverture du canal
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    // Une reprise d'hébergement échange le nœud : cet onglet était invité, il
    // devient hôte. Les écrans n'ont rien à savoir — les deux nœuds exposent la
    // même interface — mais les abonnements doivent suivre.
    const detach = onNodeReplaced((replacement) => {
      if (cancelled) return;
      epoch.current = -1;
      setNode(replacement);
      pushToast({
        message: 'L’hôte a quitté : tu héberges la partie maintenant.',
        tone: 'warning',
      });
    });

    getNode(code)
      .then((opened) => {
        if (!cancelled) setNode(opened);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Personne n'héberge ce code : l'hôte n'a pas encore créé la partie, il
        // a fermé son onglet, ou le code a été mal recopié.
        setError(
          gameError('GAME_NOT_FOUND', {
            message:
              cause instanceof Error && cause.message
                ? cause.message
                : "Cette partie n'est plus ouverte.",
          }),
        );
        setStatus('host-gone');
      });

    // Le nœud n'est **pas** fermé au démontage : il survit à la navigation
    // entre les écrans, et c'est lui qui héberge la partie quand on est l'hôte.
    // Il ne se ferme que sur un départ explicite.
    return () => {
      cancelled = true;
      detach();
    };
  }, [code, pushToast]);

  /** Tente de reprendre la session stockée pour ce code. */
  const restore = useCallback(
    async (target: GameNode): Promise<void> => {
      if (rejoining.current) return;

      const session = loadSession(code);
      if (!session) {
        setStatus('need-nickname');
        return;
      }

      rejoining.current = true;
      setStatus('restoring');

      const response = await target.emit<SessionPayload>(CLIENT_EVENTS.rejoinGame, {
        sessionToken: session.sessionToken,
      });

      rejoining.current = false;

      if (response.ok) {
        setStatus('connected');
        return;
      }

      // Session périmée (partie abandonnée, joueur retiré) : on repart du
      // formulaire plutôt que de laisser un écran bloqué.
      if (response.error.code === 'SESSION_NOT_FOUND') {
        clearSession(code);
        setStatus('need-nickname');
        return;
      }

      setError(response.error);
      setStatus('lost');
    },
    [code],
  );

  // ───────────────────────────────────────────────────────────
  //  Abonnements
  // ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!node) return;

    const handleState = (incoming: PlayerView) => {
      // Vue d'un hôte que la partie a dépassé : l'accepter ferait remonter le
      // jeu dans le temps, avec des scores et une manche périmés.
      if (incoming.epoch < epoch.current) return;

      epoch.current = incoming.epoch;
      setView(incoming);
      setStatus('connected');
    };

    const handleToast = (payload: ToastPayload) => pushToast(payload);
    const handleServerError = (payload: GameError) => setError(payload);
    const handleConnect = () => void restore(node);

    /**
     * L'hôte nous a exclu.
     *
     * On efface la session et on ferme le nœud tout de suite : sans ça, la
     * reconnexion automatique repartirait en boucle sur une partie qui ne veut
     * plus de nous, et l'écran resterait sur un « connexion perdue » trompeur.
     */
    const handleKicked = (payload: GameError) => {
      setError(payload);
      setStatus('kicked');
      setView(null);
      clearSession(code);
      closeCurrent();
    };

    const handleNodeStatus = (nodeStatus: NodeStatus) => {
      // Une exclusion est définitive : la fermeture du canal qui la suit ne doit
      // pas repasser l'écran en « connexion perdue ».
      setStatus((current) => {
        if (current === 'kicked') return current;
        if (nodeStatus === 'offline') return 'lost';
        if (nodeStatus === 'host-gone') return 'host-gone';
        return current;
      });
    };

    node.on(SERVER_EVENTS.stateUpdate, handleState);
    node.on(SERVER_EVENTS.toast, handleToast);
    node.on(SERVER_EVENTS.error, handleServerError);
    node.on(SERVER_EVENTS.kicked, handleKicked);
    node.on('connect', handleConnect);

    const unsubscribe = node.onStatus(handleNodeStatus);

    // Le canal est déjà ouvert quand on arrive ici : on reprend la session tout
    // de suite, sans attendre un `connect` qui n'aura pas lieu.
    if (node.status === 'online') void restore(node);

    return () => {
      node.off(SERVER_EVENTS.stateUpdate, handleState);
      node.off(SERVER_EVENTS.toast, handleToast);
      node.off(SERVER_EVENTS.error, handleServerError);
      node.off(SERVER_EVENTS.kicked, handleKicked);
      node.off('connect', handleConnect);
      unsubscribe();
    };
  }, [node, restore, pushToast, code]);

  // ───────────────────────────────────────────────────────────
  //  Actions
  // ───────────────────────────────────────────────────────────

  /** Émission vers le moteur. Sans canal ouvert, l'action échoue proprement. */
  const send = useCallback(
    async (event: string, payload: unknown): Promise<GameError | null> => {
      if (!node) return gameError('INTERNAL_ERROR', { message: 'Connexion en cours…' });

      const response = await node.emit<unknown>(event, payload);
      return response.ok ? null : response.error;
    },
    [node],
  );

  const join = useCallback(
    async (nickname: string): Promise<GameError | null> => {
      if (!node) return gameError('INTERNAL_ERROR', { message: 'Connexion en cours…' });

      setStatus('joining');

      const response = await node.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
        code,
        nickname,
      });

      if (!response.ok) {
        setStatus('need-nickname');
        return response.error;
      }

      saveSession(response.data);
      setStatus('connected');
      return null;
    },
    [code, node],
  );

  const startGame = useCallback(() => send(CLIENT_EVENTS.startGame, {}), [send]);

  const submitClues = useCallback(
    (placed: PlacedPicto[]) => send(CLIENT_EVENTS.submitClues, { placed }),
    [send],
  );

  const submitVotes = useCallback(
    (votes: Record<PlayerId, Slot>) => send(CLIENT_EVENTS.submitGuesses, { votes }),
    [send],
  );

  const kickPlayer = useCallback(
    (playerId: PlayerId) => send(CLIENT_EVENTS.kickPlayer, { playerId }),
    [send],
  );

  const replay = useCallback(() => send(CLIENT_EVENTS.replay, {}), [send]);
  const nextRound = useCallback(() => send(CLIENT_EVENTS.nextRound, {}), [send]);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => send(CLIENT_EVENTS.updateSettings, patch),
    [send],
  );

  const leave = useCallback(async (): Promise<void> => {
    await send(CLIENT_EVENTS.leave, {});
    clearSession(code);
    // Départ explicite : le nœud se ferme, et l'hôte efface sa sauvegarde pour
    // qu'une partie terminée ne ressuscite pas au prochain chargement.
    closeCurrent();
    setNode(null);
  }, [code, send]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    status,
    view,
    error,
    toasts,
    hosting: node?.hosting ?? false,
    join,
    startGame,
    submitClues,
    submitVotes,
    replay,
    nextRound,
    updateSettings,
    kickPlayer,
    leave,
    dismissError,
  };
}
