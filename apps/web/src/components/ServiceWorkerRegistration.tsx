'use client';

import { useEffect } from 'react';
import { BASE_PATH } from '@/lib/config';

/**
 * Enregistrement du service worker.
 *
 * Volontairement tardif — après `load` — pour ne pas disputer la bande passante
 * au premier rendu. Un échec est sans conséquence : l'application fonctionne
 * exactement pareil, elle perd seulement l'ouverture hors ligne et
 * l'installation sur l'écran d'accueil.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // En développement, un service worker qui met en cache la coquille rend le
    // rechargement à chaud imprévisible.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      void navigator.serviceWorker
        .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
        .catch(() => {
          // Rien à signaler à l'utilisateur : le jeu marche sans.
        });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
