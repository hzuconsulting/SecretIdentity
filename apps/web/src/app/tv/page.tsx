import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TvRoute } from '@/components/tv/TvRoute';

export const metadata: Metadata = {
  title: 'Écran de suivi · Identité Secrète',
  description:
    'Le score, le temps restant et les personnages d’une partie en cours, en grand — pour ceux qui regardent sans jouer.',
};

/**
 * `/tv?c=K7P4Q` — l'écran de suivi d'une partie.
 *
 * Même contrainte que `/game` : le code passe en paramètre de requête, parce
 * qu'un site exporté en statique ne sait pas générer une page par code.
 * `Suspense` est obligatoire, la lecture des paramètres d'URL suspendant le
 * rendu.
 */
export default function TvPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-ink px-5 text-white">
          <p className="tv-title font-display font-extrabold uppercase tracking-widest text-white/50">
            Chargement…
          </p>
        </main>
      }
    >
      <TvRoute />
    </Suspense>
  );
}
