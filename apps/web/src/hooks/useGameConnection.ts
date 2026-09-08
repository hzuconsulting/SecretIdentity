'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type GameError,
  type IconId,
  type IdentityId,
  type Label,
  type PlayerView,
  type SessionPayload,
  type Settings,
  type ToastPayload,
} from '@identite-secrete/shared';
import { emitWithAck, getSocket } from '@/lib/socket';
import { clearSession, loadSession, saveSession } from '@/lib/session';

/**
 * Connexion à une partie.
 *
 * Le serveur est la seule source de vérité : ce hook ne calcule aucun état de
 * jeu, il se contente de stocker la dernière `PlayerView` reçue et d'émettre
 * les actions. Aucune mise à jour optimiste — un salon qui affiche un joueur
 * que le serveur ne connaît pas serait pire qu'un demi-seconde d'attente.
 */

export type ConnectionStatus =
  | 'connecting'
  | 'restoring'
  | 'need-nickname'
  | 'joining'
  | 'connected'
  | 'lost';

interface Toast extends ToastPayload {
  id: number;
}

export interface GameConnection {
  status: ConnectionStatus;
  view: PlayerView | null;
  error: GameError | null;
  toasts: Toast[];
  join: (nickname: string) => Promise<GameError | null>;
  startGame: () => Promise<GameError | null>;
  submitClues: (iconIds: IconId[]) => Promise<GameError | null>;
  submitGuesses: (guesses: Record<Label, IdentityId>) => Promise<GameError | null>;
  replay: () => Promise<GameError | null>;
  nextRound: () => Promise<GameError | null>;
  updateSettings: (patch: Partial<Settings>) => Promise<GameError | null>;
  leave: () => Promise<void>;
  dismissError: () => void;
}

export function useGameConnection(code: string): GameConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<GameError | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Évite de relancer une reconnexion pendant qu'une autre est en cours.
  const rejoining = useRef(false);

  const pushToast = useCallback((payload: ToastPayload) => {
    const toast: Toast = { ...payload, id: Date.now() + Math.random() };
    setToasts((current) => [...current, toast]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toast.id));
    }, 4_000);
  }, []);

  /** Tente de reprendre la session stockée pour ce code. */
  const restore = useCallback(async (): Promise<void> => {
    if (rejoining.current) return;

    const session = loadSession(code);
    if (!session) {
      setStatus('need-nickname');
      return;
    }

    rejoining.current = true;
    setStatus('restoring');

    const response = await emitWithAck<SessionPayload>(
      getSocket(),
      CLIENT_EVENTS.rejoinGame,
      { sessionToken: session.sessionToken },
    );

    rejoining.current = false;

    if (response.ok) {
      setStatus('connected');
      return;
    }

    // Session périmée (partie purgée, joueur retiré) : on repart du formulaire
    // plutôt que de laisser un écran bloqué.
    if (response.error.code === 'SESSION_NOT_FOUND') {
      clearSession(code);
      setStatus('need-nickname');
      return;
    }

    setError(response.error);
    setStatus('lost');
  }, [code]);

  useEffect(() => {
    const socket = getSocket();

    const handleState = (incoming: PlayerView) => {
      setView(incoming);
      setStatus('connected');
    };

    const handleToast = (payload: ToastPayload) => pushToast(payload);
    const handleServerError = (payload: GameError) => setError(payload);

    const handleConnect = () => {
      void restore();
    };

    const handleDisconnect = () => {
      setStatus('lost');
    };

    socket.on(SERVER_EVENTS.stateUpdate, handleState);
    socket.on(SERVER_EVENTS.toast, handleToast);
    socket.on(SERVER_EVENTS.error, handleServerError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) void restore();

    return () => {
      socket.off(SERVER_EVENTS.stateUpdate, handleState);
      socket.off(SERVER_EVENTS.toast, handleToast);
      socket.off(SERVER_EVENTS.error, handleServerError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [restore, pushToast]);

  const join = useCallback(
    async (nickname: string): Promise<GameError | null> => {
      setStatus('joining');

      const response = await emitWithAck<SessionPayload>(
        getSocket(),
        CLIENT_EVENTS.joinGame,
        { code, nickname },
      );

      if (!response.ok) {
        setStatus('need-nickname');
        return response.error;
      }

      saveSession(response.data);
      setStatus('connected');
      return null;
    },
    [code],
  );

  const startGame = useCallback(async (): Promise<GameError | null> => {
    const response = await emitWithAck<null>(getSocket(), CLIENT_EVENTS.startGame, {});
    return response.ok ? null : response.error;
  }, []);

  const submitClues = useCallback(
    async (iconIds: IconId[]): Promise<GameError | null> => {
      const response = await emitWithAck<null>(getSocket(), CLIENT_EVENTS.submitClues, {
        iconIds,
      });
      return response.ok ? null : response.error;
    },
    [],
  );

  const submitGuesses = useCallback(
    async (guesses: Record<Label, IdentityId>): Promise<GameError | null> => {
      const response = await emitWithAck<null>(getSocket(), CLIENT_EVENTS.submitGuesses, {
        guesses,
      });
      return response.ok ? null : response.error;
    },
    [],
  );

  const replay = useCallback(async (): Promise<GameError | null> => {
    const response = await emitWithAck<null>(getSocket(), CLIENT_EVENTS.replay, {});
    return response.ok ? null : response.error;
  }, []);

  const nextRound = useCallback(async (): Promise<GameError | null> => {
    const response = await emitWithAck<null>(getSocket(), CLIENT_EVENTS.nextRound, {});
    return response.ok ? null : response.error;
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>): Promise<GameError | null> => {
      const response = await emitWithAck<null>(
        getSocket(),
        CLIENT_EVENTS.updateSettings,
        patch,
      );
      return response.ok ? null : response.error;
    },
    [],
  );

  const leave = useCallback(async (): Promise<void> => {
    await emitWithAck<null>(getSocket(), CLIENT_EVENTS.leave, {});
    clearSession(code);
  }, [code]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    status,
    view,
    error,
    toasts,
    join,
    startGame,
    submitClues,
    submitGuesses,
    replay,
    nextRound,
    updateSettings,
    leave,
    dismissError,
  };
}
