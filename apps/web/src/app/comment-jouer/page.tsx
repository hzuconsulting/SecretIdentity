import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_SETTINGS, MAX_PLAYERS, MIN_PLAYERS } from '@identite-secrete/shared';
import { Card, Eyebrow } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Comment jouer ? · Identité Secrète',
};

/**
 * Cinq étapes, dans l'ordre où elles arrivent pendant une manche.
 * La numérotation encode une vraie séquence : elle sert à se repérer.
 */
const STEPS = [
  {
    title: 'Tu reçois une identité',
    body: 'Au début de chaque manche, le jeu t’attribue un personnage. Toi seul le vois — personne d’autre, jamais.',
  },
  {
    title: 'Tu choisis tes indices',
    body: `Dans ta main d’icônes, tu en sélectionnes jusqu’à ${DEFAULT_SETTINGS.maxClues}. Elles doivent évoquer ton personnage sans le nommer.`,
  },
  {
    title: 'Tout le monde valide',
    body: 'Les séries d’indices apparaissent mélangées et anonymes : Joueur A, Joueur B, Joueur C… Impossible de savoir qui a joué quoi.',
  },
  {
    title: 'Tu associes',
    body: 'Tu relies chaque série d’indices à une identité. Ta propre série n’est pas dans la liste, et chaque identité ne sert qu’une fois.',
  },
  {
    title: 'Tout est révélé',
    body: 'Un point par joueur qui a trouvé ton personnage, un point par identité que tu as trouvée. Le meilleur des deux mondes : bien indicer, et bien deviner.',
  },
] as const;

export default function HowToPlayPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
      <div>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-display text-sm font-extrabold uppercase tracking-widest text-violet"
        >
          ← Accueil
        </Link>
        <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight">
          Comment jouer&nbsp;?
        </h1>
        <p className="mt-2 text-base font-semibold text-muted">
          {MIN_PLAYERS} à {MAX_PLAYERS} joueurs, chacun sur son téléphone. Une manche dure
          deux minutes.
        </p>
      </div>

      <ol className="flex flex-col gap-4">
        {STEPS.map((step, index) => (
          <Card key={step.title} as="li" className="flex gap-4">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-light font-display text-lg font-black text-violet-dark"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold leading-tight">
                {step.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink/80">{step.body}</p>
            </div>
          </Card>
        ))}
      </ol>

      <Card as="section">
        <Eyebrow tone="mint">Les points</Eyebrow>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Deux façons de marquer, à chaque manche :
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink/80">
          <li>
            <strong>Faire deviner&nbsp;: +1</strong> par joueur qui a trouvé ton
            personnage.
          </li>
          <li>
            <strong>Bonnes réponses&nbsp;: +1</strong> par identité que tu as
            correctement attribuée.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Des indices trop obscurs ne rapportent rien, des indices trop évidents non plus
          — puisque tout le monde trouve, personne ne se distingue. Le bon niveau se situe
          entre les deux.
        </p>
      </Card>

      <Card className="bg-violet-light" as="section">
        <Eyebrow tone="violet">La règle qui surprend</Eyebrow>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Tu ne devines jamais ta propre série, et tu ne peux pas attribuer deux fois la
          même identité. Si tu choisis une identité déjà utilisée ailleurs, les deux
          réponses s’échangent automatiquement.
        </p>
      </Card>

      <Card as="section">
        <Eyebrow tone="sun">Sur un canapé, à plusieurs</Eyebrow>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink/80">
          <li>
            <strong>👁 Masquer mon identité</strong> cache ton personnage. Maintiens le
            bouton pour le revoir une seconde, à l’abri des regards.
          </li>
          <li>
            <strong>🔊 dans l’en-tête</strong> coupe les sons. Le réglage est mémorisé sur
            ton téléphone.
          </li>
          <li>
            Si quelqu’un perd le réseau, sa place est gardée et la partie l’attend. En
            dessous de trois joueurs connectés, tout se met en pause.
          </li>
        </ul>
      </Card>
    </main>
  );
}
