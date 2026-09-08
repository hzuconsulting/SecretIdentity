'use client';

import { useEffect, useRef, useState } from 'react';
import { currentNode, measureClockOffset } from '@/lib/net';

/**
 * Horloge de l'hôte.
 *
 * `phaseEndsAt` est un timestamp produit par le téléphone qui héberge. Un
 * appareil dont l'horloge avance de quarante secondes afficherait un décompte
 * faux si on comparait à son `Date.now()` local. On mesure donc le décalage à
 * l'ouverture du canal, puis régulièrement — une mise en veille prolongée le
 * fait dériver.
 *
 * Ce hook ne sert **qu'à l'affichage**. La fin d'une phase est décidée par le
 * moteur, et par lui seul : afficher `00:00` ne déclenche rien.
 *
 * Chez l'hôte lui-même, le décalage est nul par construction : la mesure passe
 * par le moteur local et revient immédiatement.
 */

const RESYNC_INTERVAL_MS = 30_000;

export function useServerClock(): { serverNow: () => number; offsetMs: number } {
  const [offsetMs, setOffsetMs] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      const node = currentNode();
      if (!node || node.status !== 'online') return;

      measureClockOffset(node)
        .then((offset) => {
          if (cancelled) return;
          offsetRef.current = offset;
          setOffsetMs(Math.round(offset));
        })
        .catch(() => {
          // Hôte injoignable : on garde le dernier décalage connu. Le décompte
          // reste approximativement juste, et la reconnexion relancera une mesure.
        });
    };

    sync();
    const interval = setInterval(sync, RESYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return {
    serverNow: () => Date.now() + offsetRef.current,
    offsetMs,
  };
}
