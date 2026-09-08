'use client';

import { useEffect, useRef, useState } from 'react';
import {
  TIMER_URGENT_SECONDS,
  formatCountdown,
  secondsRemaining,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSound } from '@/hooks/useSound';

interface TimerProps {
  /** Timestamp serveur. `null` = pas de limite de temps. */
  phaseEndsAt: number | null;
}

/**
 * Décompte de phase.
 *
 * Il affiche, il ne décide pas. Quand il atteint `00:00`, il reste à zéro et
 * attend l'événement serveur : c'est le serveur qui change de phase, jamais
 * ce composant (§4.2).
 *
 * L'urgence est signalée par **trois** signaux simultanés — couleur, icône et
 * pulsation — parce que la couleur seule ne suffit pas (§7.4). La pulsation
 * disparaît si `prefers-reduced-motion` est actif.
 */
export function Timer({ phaseEndsAt }: TimerProps) {
  const { serverNow } = useServerClock();
  const { play } = useSound();
  // Le bip d'urgence ne sonne qu'une fois par phase : le répéter à chaque
  // seconde serait insupportable, et n'ajouterait aucune information.
  const warned = useRef<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(() =>
    secondsRemaining(phaseEndsAt, serverNow()),
  );

  useEffect(() => {
    if (phaseEndsAt === null) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const value = secondsRemaining(phaseEndsAt, serverNow());
      setRemaining(value);

      if (
        value !== null &&
        value <= TIMER_URGENT_SECONDS &&
        value > 0 &&
        warned.current !== phaseEndsAt
      ) {
        warned.current = phaseEndsAt;
        play('urgent');
      }
    };
    tick();

    // 250 ms plutôt qu'une seconde : le chiffre change au bon moment même si
    // le rendu tombe juste après une bascule.
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phaseEndsAt, serverNow, play]);

  if (remaining === null) {
    return (
      <p className="flex items-center gap-1.5 font-display text-lg font-black tabular-nums">
        <span aria-hidden="true">♾️</span>
        <span className="sr-only">Temps restant : </span>
        Sans limite
      </p>
    );
  }

  const urgent = remaining <= TIMER_URGENT_SECONDS;

  return (
    <p
      className={[
        'flex items-center gap-1.5 font-display text-2xl font-black tabular-nums',
        urgent ? 'text-pink motion-safe:animate-pulse' : 'text-ink',
      ].join(' ')}
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <span aria-hidden="true">{urgent ? '⏳' : '⏱️'}</span>
      <span className="sr-only">Temps restant : </span>
      {formatCountdown(remaining)}
    </p>
  );
}
