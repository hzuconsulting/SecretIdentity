'use client';

import Link from 'next/link';
import { gameHref, useResumableGame } from '@/components/ResumeGameBanner';

/**
 * « ← Retour à la partie », sur la page des règles.
 *
 * En application plein écran, il n'y a pas de bouton retour du navigateur :
 * sans ce lien, un joueur arrivé ici depuis un vieux marque-page ou l'accueil
 * n'aurait que « Accueil » pour repartir. Absent s'il n'y a pas de partie.
 */
export function BackToGameLink({ block = false }: { block?: boolean }) {
  const code = useResumableGame();
  if (!code) return null;

  return (
    <Link
      href={gameHref(code)}
      className={[
        'items-center justify-center bg-violet font-display font-extrabold uppercase text-white',
        'shadow-tile active:translate-y-0.5 active:shadow-tile-active',
        block
          ? 'flex min-h-[56px] w-full rounded-tile px-6 text-base tracking-wide'
          : 'inline-flex min-h-[44px] rounded-full px-4 text-sm tracking-wide',
      ].join(' ')}
    >
      ← Retour à la partie
      {/* En version compacte, le code ferait passer le lien à la ligne. */}
      {block ? <span className="ml-2 tracking-[0.2em] text-white/70">{code}</span> : null}
    </Link>
  );
}
