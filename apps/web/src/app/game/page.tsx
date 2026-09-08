import { Suspense } from 'react';
import type { Metadata } from 'next';
import { GameRoute } from '@/components/game/GameRoute';

export const metadata: Metadata = {
  title: 'Partie · Identité Secrète',
};

/**
 * `/game?c=K7P4Q` — la cible des liens partagés.
 *
 * Le code est passé en paramètre de requête plutôt qu'en segment d'URL, parce
 * que le site est exporté en statique : un segment dynamique demanderait au
 * site de générer une page par code, ce qu'un hébergement de fichiers ne
 * sait pas faire. Le paramètre, lui, est lu par le navigateur.
 *
 * `Suspense` est obligatoire : la lecture des paramètres d'URL suspend le rendu.
 */
export default function GamePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center px-5">
          <p className="font-display text-lg font-extrabold uppercase tracking-widest text-muted">
            Chargement…
          </p>
        </main>
      }
    >
      <GameRoute />
    </Suspense>
  );
}
