'use client';

import { useEffect, useState } from 'react';
import { getSocket, measureClockOffset } from '@/lib/socket';

type Status = 'connecting' | 'online' | 'offline';

interface State {
  status: Status;
  offsetMs: number | null;
}

/**
 * État de la liaison temps réel.
 *
 * Ce n'est pas un gadget : c'est la seule chose qui distingue « le serveur ne
 * tourne pas » de « le serveur refuse mon origine CORS ». Les deux arrivent
 * tout le temps en développement, et le message doit dire quoi faire.
 */
export function ServerStatus() {
  const [{ status, offsetMs }, setState] = useState<State>({
    status: 'connecting',
    offsetMs: null,
  });

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;

    const syncClock = () => {
      measureClockOffset(socket)
        .then((offset) => {
          if (!cancelled) setState({ status: 'online', offsetMs: Math.round(offset) });
        })
        .catch(() => {
          if (!cancelled) setState({ status: 'offline', offsetMs: null });
        });
    };

    const handleDisconnect = () => {
      if (!cancelled) setState({ status: 'offline', offsetMs: null });
    };

    socket.on('connect', syncClock);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);

    if (socket.connected) syncClock();

    return () => {
      cancelled = true;
      socket.off('connect', syncClock);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
    };
  }, []);

  const dot =
    status === 'online' ? 'bg-mint' : status === 'connecting' ? 'bg-sun' : 'bg-pink';

  const label =
    status === 'online'
      ? `Serveur connecté · horloge synchronisée (${offsetMs} ms d'écart)`
      : status === 'connecting'
        ? 'Connexion au serveur…'
        : 'Serveur injoignable — lance « npm run dev » et vérifie NEXT_PUBLIC_SERVER_URL';

  return (
    <p
      className="flex items-center justify-center gap-2 text-center text-sm text-muted"
      aria-live="polite"
    >
      <span
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
        aria-hidden="true"
      />
      {label}
    </p>
  );
}
