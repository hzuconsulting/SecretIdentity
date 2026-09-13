import Link from 'next/link';
import { ICONS, IDENTITIES, MAX_PLAYERS, MIN_PLAYERS } from '@identite-secrete/shared';
import { ConnectionCheck } from '@/components/ConnectionCheck';
import { HowToPlayCard } from '@/components/home/HowToPlayCard';
import { OpenGames } from '@/components/home/OpenGames';
import { ResumeGameBanner } from '@/components/ResumeGameBanner';
import { ButtonLink } from '@/components/ui/Button';

/**
 * L'accueil tient en un écran de téléphone jusqu'aux parties ouvertes : titre
 * sur une ligne, les deux actions, puis la liste. L'illustration et les règles
 * viennent après — on les lit une fois, alors qu'on revient ici à chaque soirée.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="text-center">
        <h1 className="text-stroke-ink font-display text-[2.1rem] font-black uppercase leading-none tracking-tight">
          Identité <span className="text-violet">Secrète</span>
        </h1>
        <p className="mx-auto mt-1.5 text-balance text-base font-semibold text-muted">
          Fais deviner ton personnage sans dire un mot.
        </p>
      </header>

      {/* Une partie en cours sur cet appareil passe avant tout le reste. */}
      <ResumeGameBanner />

      <nav className="flex flex-col gap-3" aria-label="Actions principales">
        <ButtonLink href="/creer">Créer une partie</ButtonLink>
        <ButtonLink href="/rejoindre" variant="soft">
          Rejoindre une partie
        </ButtonLink>
      </nav>

      <OpenGames />

      <HowToPlayCard />

      <footer className="mt-auto flex flex-col gap-3 pt-3">
        <ConnectionCheck />
        <p className="text-center text-xs text-muted">
          {MIN_PLAYERS} à {MAX_PLAYERS} joueurs · {IDENTITIES.length} identités ·{' '}
          {ICONS.length} icônes ·{' '}
          <Link href="/credits" className="underline decoration-muted/40 underline-offset-2">
            Crédits photos
          </Link>
        </p>
      </footer>
    </main>
  );
}
