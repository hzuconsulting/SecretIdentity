import Link from 'next/link';
import {
  BOARD_SIZE,
  MAX_PICTOS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_HAND_CARDS,
  TIMER_OPTIONS,
  TOTAL_ROUNDS,
  autoClueSeconds,
  autoGuessSeconds,
  formatDuration,
} from '@identite-secrete/shared';
import { Card, Eyebrow } from '@/components/ui/Card';

/**
 * Le texte des règles, sans cadre de page.
 *
 * Partagé entre la page `/comment-jouer` et le panneau « Règles » ouvert en
 * pleine partie : une seule source, pour que les deux ne divergent jamais.
 * Aucun état, aucun effet — utilisable côté serveur comme côté client.
 *
 * Les chiffres viennent des constantes du jeu, jamais écrits en dur : changer
 * une règle met le texte à jour tout seul.
 */

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
    body: `Tu poses 1 à ${MAX_PICTOS} pictogrammes, chacun pris sur une carte différente de ta main. En zone verte : « mon personnage, c’est ça ». En zone rouge : « ce n’est pas ça ».`,
  },
  {
    title: 'Tout le monde vote',
    body: 'Les boîtiers sont posés devant leurs propriétaires. Tu attribues un numéro du plateau à chaque joueur — mais tu n’as qu’une carte Vote par numéro.',
  },
  {
    title: 'Tout est révélé',
    body: 'Les personnages se dévoilent un par un. Un point par joueur qui a trouvé ton personnage, un point par joueur que tu as correctement identifié. Pas de chrono : l’hôte lance la manche suivante quand tout le monde a vu.',
  },
] as const;

const FIXED_DURATIONS = TIMER_OPTIONS.filter(
  (option): option is number => typeof option === 'number',
);
const SHORTEST = formatDuration(Math.min(...FIXED_DURATIONS));
const LONGEST = formatDuration(Math.max(...FIXED_DURATIONS));

const AUTO_CLUE = `${formatDuration(autoClueSeconds(MIN_PLAYERS))} à ${MIN_PLAYERS} joueurs, ${formatDuration(autoClueSeconds(MAX_PLAYERS))} à ${MAX_PLAYERS}`;
const AUTO_GUESS = `${formatDuration(autoGuessSeconds(MIN_PLAYERS))} à ${MIN_PLAYERS} joueurs, ${formatDuration(autoGuessSeconds(MAX_PLAYERS))} à ${MAX_PLAYERS}`;

interface RulesContentProps {
  /**
   * Niveau des titres de section. 2 sous le `<h1>` de la page ; 3 dans le
   * panneau, dont le titre est déjà un `<h2>`.
   */
  headingLevel?: 2 | 3;
}

export function RulesContent({ headingLevel = 2 }: RulesContentProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div className="flex flex-col gap-6">
      <p className="text-base font-semibold text-muted">
        {MIN_PLAYERS} à {MAX_PLAYERS} joueurs, chacun sur son téléphone.{' '}
        {TOTAL_ROUNDS} manches, et le plus de points l’emporte.
      </p>

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
              <Heading className="font-display text-lg font-extrabold leading-tight">
                {step.title}
              </Heading>
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
        <Eyebrow tone="pink">Le temps</Eyebrow>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Poser ses pictogrammes et voter se font contre la montre. Par défaut, la durée
          est sur <strong>Auto</strong> : elle s’adapte au nombre de joueurs.
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink/80">
          <li>
            <strong>Poser&nbsp;:</strong> {AUTO_CLUE}.
          </li>
          <li>
            <strong>Voter&nbsp;:</strong> {AUTO_GUESS} — il y a plus de boîtiers à lire.
          </li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          Dans le salon, l’hôte peut aussi choisir une durée fixe, de {SHORTEST} à{' '}
          {LONGEST}, ou jouer sans limite.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink/80">
          À la fin du temps, ton boîtier part tel quel — s’il est vide, une carte de ta
          main est jouée au hasard à ta place. Un vote laissé vide ne rapporte rien. La
          révélation, elle, n’a pas de minuteur : c’est l’hôte qui lance la manche
          suivante.
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
            <strong>Le code de la partie</strong> reste affiché en haut de l’écran. Le menu{' '}
            <strong>☰</strong> ramène à l’accueil sans quitter la partie, ou la quitte.
          </li>
          <li>
            Parti·e par erreur&nbsp;? Reviens avec le code et <strong>le même pseudo</strong>{' '}
            : ta place t’attend.
          </li>
          <li>
            <strong>L’hôte peut exclure un joueur</strong>, depuis le salon comme en cours
            de partie.
          </li>
          <li>
            Si quelqu’un perd le réseau, sa place est gardée et la partie l’attend. En
            dessous de {MIN_PLAYERS} joueurs connectés, tout se met en pause.
          </li>
          <li>
            La partie tourne sur le téléphone de l’hôte. S’il s’en va, un autre joueur
            prend le relais.
          </li>
        </ul>
      </Card>

      <p className="text-center text-xs text-muted">
        Portraits&nbsp;: Wikimedia Commons, sous licence libre ·{' '}
        {/*
          Dans le panneau ouvert en pleine partie (titres de niveau 3), le lien
          ouvre un autre onglet : quitter l'écran de jeu perdrait le boîtier en
          cours, et le panneau existe justement pour l'éviter.
        */}
        <Link
          href="/credits"
          {...(headingLevel === 3 ? { target: '_blank', rel: 'noopener' } : {})}
          className="underline decoration-muted/40 underline-offset-2"
        >
          Crédits photos
        </Link>
      </p>
    </div>
  );
}
