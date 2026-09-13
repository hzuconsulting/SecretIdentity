'use client';

import { useEffect, useState } from 'react';

/**
 * La partie de l'écran réellement visible, clavier déduit.
 *
 * Quand le clavier monte, ni iOS ni Chrome Android ne réduisent la page : ils
 * réduisent seulement la zone affichée. `100dvh` et `bottom: 0` restent donc
 * calés sur l'écran entier, et un champ posé en bas finit sous le clavier.
 * `visualViewport`, lui, dit exactement ce qu'on voit.
 */

export interface VisualViewportBox {
  /** Décalage du haut de la zone visible, en px (iOS fait glisser la page). */
  top: number;
  height: number;
  /** Assez d'écran caché pour que ce soit le clavier, pas une barre d'adresse. */
  keyboardOpen: boolean;
}

const KEYBOARD_MIN_PX = 120;

/** `null` tant qu'inactif, avant le montage, ou sans `visualViewport`. */
export function useVisualViewportBox(active: boolean): VisualViewportBox | null {
  const [box, setBox] = useState<VisualViewportBox | null>(null);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!active || !viewport) {
      setBox(null);
      return;
    }

    let frame = 0;

    const measure = () => {
      frame = 0;
      const next: VisualViewportBox = {
        top: Math.round(viewport.offsetTop),
        height: Math.round(viewport.height),
        // Un zoom au doigt réduit aussi la zone visible : ce n'est pas le clavier.
        keyboardOpen:
          viewport.scale < 1.05 && window.innerHeight - viewport.height > KEYBOARD_MIN_PX,
      };
      setBox((current) =>
        current &&
        current.top === next.top &&
        current.height === next.height &&
        current.keyboardOpen === next.keyboardOpen
          ? current
          : next,
      );
    };

    // Les deux événements tombent en rafale pendant l'animation du clavier :
    // une mesure par image suffit.
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
    };
  }, [active]);

  return active ? box : null;
}
