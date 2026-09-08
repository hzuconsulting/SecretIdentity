'use client';

import { useEffect, useRef, useState } from 'react';
import { getSocket, measureClockOffset } from '@/lib/socket';

/**
 * Horloge serveur.
 *
 * `phaseEndsAt` est un timestamp **serveur**. Un téléphone dont l'horloge
 * avance de quarante secondes afficherait un décompte faux si on comparait à
 * `Date.now()` local. On mesure donc le décalage à la connexion, puis
 * régulièrement — une mise en veille prolongée le fait dériver.
 *
 * Ce hook ne sert **qu'à l'affichage**. La fin d'une phase est décidée par le
 * serveur, et par lui seul : afficher `00:00` ne déclenche rien.
 */

const RESYNC_INTERVAL_MS = 30_000;

export function useServerClock(): { serverNow: () => number; offsetMs: number } {
  const [offsetMs, setOffsetMs] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    const socket = getSocket();
    let cancelled = false;

    const sync = () => {
      measureClockOffset(socket)
        .then((offset) => {
          if (cancelled) return;
          offsetRef.current = offset;
          setOffsetMs(Math.round(offset));
        })
        .catch(() => {
          // Serveur injoignable : on garde le dernier décalage connu. Le
          // décompte reste approximativement juste, et la reconnexion
          // relancera une mesure.
        });
    };

    socket.on('connect', sync);
    if (socket.connected) sync();

    const interval = setInterval(sync, RESYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      socket.off('connect', sync);
    };
  }, []);

  return {
    serverNow: () => Date.now() + offsetRef.current,
    offsetMs,
  };
}
