import Link from 'next/link';
import { ICONS, IDENTITIES, MAX_PLAYERS, MIN_PLAYERS } from '@identite-secrete/shared';
import { HomeHero } from '@/components/HomeHero';
import { ConnectionCheck } from '@/components/ConnectionCheck';
import { OpenGames } from '@/components/home/OpenGames';
import { ResumeGameBanner } from '@/components/ResumeGameBanner';
import { ButtonLink } from '@/components/ui/Button';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 py-10">
      <header className="text-center">
        <h1 className="text-stroke-ink font-display text-[2.6rem] font-black uppercase leading-[0.95] tracking-tight">
          Identité
          <br />
          <span className="text-violet">Secrète</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-balance text-lg font-semibold text-muted">
          Fais deviner ton personnage sans dire un mot.
        </p>
      </header>

      {/* Une partie en cours sur cet appareil passe avant tout le reste. */}
      <ResumeGameBanner />

      <HomeHero />

      <nav className="flex flex-col gap-3" aria-label="Actions principales">
        <ButtonLink href="/creer">Créer une partie</ButtonLink>
        <ButtonLink href="/rejoindre" variant="soft">
          Rejoindre une partie
        </ButtonLink>
        <ButtonLink href="/comment-jouer" variant="ghost" size="md">
          Comment jouer&nbsp;?
        </ButtonLink>
      </nav>

      <OpenGames />

      <footer className="mt-auto flex flex-col gap-3">
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
