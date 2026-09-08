'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  isSoundEnabled,
  playSound,
  setSoundEnabled,
  subscribeSound,
  type SoundName,
} from '@/lib/sound';

/**
 * Accès aux sons depuis un composant.
 *
 * La préférence vit hors de React (`lib/sound.ts`) pour rester unique : deux
 * écrans montés en même temps ne doivent pas avoir chacun leur idée du réglage.
 * `useSyncExternalStore` fait le pont, et rend le rendu serveur cohérent en
 * annonçant « activé » avant hydratation — aucun son ne part au chargement de
 * toute façon.
 */
export function useSound(): {
  enabled: boolean;
  toggle: () => void;
  play: (name: SoundName) => void;
} {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => true);

  const toggle = useCallback(() => {
    const next = !isSoundEnabled();
    setSoundEnabled(next);
    // Retour sonore immédiat à l'activation : sans lui, on ne sait pas si ça
    // a marché tant qu'un événement de jeu n'est pas survenu.
    if (next) playSound('confirm');
  }, []);

  const play = useCallback((name: SoundName) => playSound(name), []);

  return { enabled, toggle, play };
}
