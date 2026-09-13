'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { latestSession } from '@/lib/session';

/**
 * Le même que `CODE_PARAM` (`components/game/GameRoute.tsx`), recopié plutôt
 * qu'importé : l'importer embarquerait tout le client de jeu dans l'accueil et
 * la page des règles (même choix que `home/OpenGames.tsx`).
 */
const CODE_PARAM = 'c';

/**
 * Code de la partie en cours sur ce navigateur, ou `null`.
 *
 * Lu après le montage seulement : le stockage local n'existe pas au rendu
 * statique, et le lire pendant le rendu ferait diverger l'hydratation. Relu
 * quand l'onglet revient au premier plan ou qu'un autre onglet change les
 * sessions — quitter la partie ailleurs doit faire disparaître le lien ici.
 */
export function useResumableGame(): string | null {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setCode(latestSession()?.session.code.toUpperCase() ?? null);
    refresh();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return code;
}

/** Lien vers une partie. `next/link` ajoute lui-même le préfixe du site. */
export function gameHref(code: string): string {
  return `/game?${CODE_PARAM}=${code}`;
}

/**
 * « Partie en cours · K7P4Q — Revenir ».
 *
 * En mode application (PWA plein écran), il n'y a pas de bouton retour : un
 * joueur passé par l'accueil n'aurait aucun moyen de retrouver sa partie. Ce
 * bandeau est ce moyen. `/game?c=…` reprend la session tout seul — pas de
 * pseudo à retaper.
 *
 * Ne rend rien s'il n'y a pas de partie à reprendre.
 */
export function ResumeGameBanner({ className }: { className?: string }) {
  const code = useResumableGame();
  if (!code) return null;

  return (
    <Link
      href={gameHref(code)}
      className={[
        'flex min-h-[64px] w-full items-center gap-3 rounded-tile bg-ink px-4 py-3 text-left text-white shadow-tile',
        'transition-[transform,box-shadow] duration-150 active:translate-y-1 active:shadow-tile-active',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full bg-mint opacity-75 motion-safe:animate-ping" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-mint" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block font-display text-xs font-extrabold uppercase tracking-widest text-white/60">
          Partie en cours
        </span>
        <span className="block font-display text-xl font-black tracking-[0.2em]">
          <span className="sr-only">code </span>
          {code}
        </span>
      </span>

      <span className="shrink-0 rounded-full bg-sun px-4 py-2 font-display text-sm font-extrabold uppercase tracking-wide text-ink">
        Revenir
      </span>
    </Link>
  );
}
