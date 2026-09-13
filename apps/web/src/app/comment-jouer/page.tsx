import type { Metadata } from 'next';
import Link from 'next/link';
import { RulesContent } from '@/components/rules/RulesContent';
import { BackToGameLink } from '@/components/rules/BackToGameLink';

export const metadata: Metadata = {
  title: 'Comment jouer ? · Identité Secrète',
};

/**
 * La page des règles, hors partie.
 *
 * En partie, les règles s'ouvrent dans un panneau par-dessus l'écran de jeu
 * (`RulesSheet`) : on n'arrive donc ici que depuis l'accueil — ou d'un ancien
 * lien. Le texte est le même, dans `RulesContent`. Si une partie est en cours
 * sur ce téléphone, un lien y ramène : en application plein écran, il n'y a pas
 * de bouton retour.
 */
export default function HowToPlayPage() {
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
          <BackToGameLink />
        </nav>
        <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight">
          Comment jouer&nbsp;?
        </h1>
      </div>

      <RulesContent />

      {/* La page est longue : on ne remonte pas tout en haut pour repartir. */}
      <BackToGameLink block />
    </main>
  );
}
