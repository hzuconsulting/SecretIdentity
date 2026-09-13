import type { Metadata } from 'next';
import Link from 'next/link';
import { PortraitCredits } from './PortraitCredits';

export const metadata: Metadata = {
  title: 'Crédits photos · Identité Secrète',
};

/**
 * Les crédits des portraits (D-85).
 *
 * Chaque photo est sous licence libre, et la plupart de ces licences demandent
 * de citer l'auteur : c'est ici qu'on le fait, avec la licence et la page du
 * fichier. La liste est lue dans le navigateur, depuis le même fichier que les
 * écrans de jeu — la page elle-même reste statique.
 */
export default function CreditsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div>
        <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Navigation">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center font-display text-sm font-extrabold uppercase tracking-widest text-violet"
          >
            ← Accueil
          </Link>
        </nav>
        <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight">
          Crédits photos
        </h1>
      </div>

      <p className="text-base font-semibold text-muted">
        Les portraits des personnages viennent de{' '}
        <a
          href="https://commons.wikimedia.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet underline decoration-violet/30 underline-offset-2"
        >
          Wikimedia Commons
        </a>
        , sous licence libre. Merci à leurs auteurs. Un personnage sans photo libre garde
        simplement son initiale.
      </p>

      <PortraitCredits />
    </main>
  );
}
