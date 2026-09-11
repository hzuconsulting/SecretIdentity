import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BOARD_SIZE,
  MAX_PICTOS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_HAND_CARDS,
  TOTAL_ROUNDS,
} from '@identite-secrete/shared';
import { Card, Eyebrow } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'Comment jouer ? · Identité Secrète',
};

/**
 * Les étapes, dans l'ordre où elles arrivent pendant une manche.
 * La numérotation encode une vraie séquence : elle sert à se repérer.
 */
const STEPS = [
  {
    title: `${BOARD_SIZE} personnages sur la table`,
    body: `Chaque manche commence par ${BOARD_SIZE} personnages numérotés de 1 à ${BOARD_SIZE}, visibles de tous. Ils changent à chaque manche.`,
  },
  {
    title: 'Tu reçois un numéro secret',
    body: 'Ta carte Mystère t’attribue l’un de ces numéros. Toi seul le connais — c’est ce personnage-là que tu dois faire deviner.',
  },
  {
    title: 'Tu remplis ton boîtier',
    body: `Tu poses 1 à ${MAX_PICTOS} pictogrammes. En zone verte : « mon personnage, c’est ça ». En zone rouge : « ce n’est pas ça ». À toi de choisir ce qui parle le mieux.`,
  },
  {
    title: 'Tout le monde vote',
    body: 'Les boîtiers sont posés devant leurs propriétaires. Tu attribues un numéro du plateau à chaque joueur — mais tu n’as qu’une carte Vote par numéro.',
  },
  {
    title: 'Tout est révélé',
    body: 'Un point par joueur qui a trouvé ton personnage, un point par joueur que tu as correctement identifié.',
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
          {MIN_PLAYERS} à {MAX_PLAYERS} joueurs, chacun sur son téléphone.{' '}
          {TOTAL_ROUNDS} manches, et le plus de points l’emporte.
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

      <Card className="bg-violet-light" as="section">
        <Eyebrow tone="violet">Tes cartes ne se rechargent jamais</Eyebrow>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Tu reçois <strong>{STARTING_HAND_CARDS} cartes Picto au début de la partie</strong>,
          et c’est tout. Chaque carte porte quatre pictogrammes, deux au recto et deux au
          verso : tu n’en montres qu’un, et la carte entière part à la défausse — les trois
          autres avec elle.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          {STARTING_HAND_CARDS} cartes pour {TOTAL_ROUNDS} manches à {MAX_PICTOS} maximum :
          dépenser trois cartes dès la première manche, c’est finir la partie à court
          d’idées. À égalité de points, c’est d’ailleurs celui qui en a gardé le plus qui
          gagne.
        </p>
      </Card>

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
            <strong>Bonnes réponses&nbsp;: +1</strong> par joueur dont tu as trouvé le
            personnage.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Des pictogrammes trop obscurs ne rapportent rien, des pictogrammes trop évidents
          non plus — puisque tout le monde trouve, personne ne se distingue. Le bon niveau
          se situe entre les deux.
        </p>
      </Card>

      <Card className="bg-sun-light" as="section">
        <Eyebrow tone="sun">La règle qui surprend</Eyebrow>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Il y a toujours {BOARD_SIZE} personnages, même à {MIN_PLAYERS} joueurs.{' '}
          <strong>Certains numéros ne correspondent donc à personne.</strong> Impossible de
          s’en sortir par élimination : il faut vraiment lire les pictogrammes.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Tu ne votes jamais pour toi-même, et tu ne peux pas donner deux fois le même
          numéro. Si tu choisis un numéro déjà attribué, les deux votes s’échangent
          automatiquement.
        </p>
      </Card>

      <Card as="section">
        <Eyebrow tone="violet">Sur un canapé, à plusieurs</Eyebrow>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink/80">
          <li>
            <strong>👁 Masquer ma carte</strong> cache ton personnage. Maintiens le bouton
            pour le revoir une seconde, à l’abri des regards.
          </li>
          <li>
            <strong>🔊 dans l’en-tête</strong> coupe les sons. Le réglage est mémorisé sur
            ton téléphone.
          </li>
          <li>
            <strong>L’hôte peut exclure un joueur</strong>, depuis le salon comme en cours
            de partie.
          </li>
          <li>
            Si quelqu’un perd le réseau, sa place est gardée et la partie l’attend. En
            dessous de {MIN_PLAYERS} joueurs connectés, tout se met en pause.
          </li>
        </ul>
      </Card>
    </main>
  );
}
