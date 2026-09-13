'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  getIdentity,
  type IdentityId,
  type PlayerView,
  type RoundReveal,
  type Slot,
} from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import type { SoundName } from '@/lib/sound';
import { Button } from '@/components/ui/Button';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PictoCase } from './PictoCase';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { Portrait } from './Portrait';

interface ResultsScreenProps {
  view: PlayerView;
  onNextRound: () => Promise<unknown>;
}

/** Laisse finir la note de changement de phase avant le verdict. */
const VERDICT_DELAY_MS = 400;

/**
 * Fin de manche : tout est révélé, et on prend son temps.
 *
 * **Pas de minuteur.** C'est le moment où la table discute — « tu m'as pris pour
 * Hercule ? », « mais le rouge voulait dire *pas* un enfant ! » — et un décompte
 * coupait la conversation au milieu. L'hôte lance la manche suivante quand tout
 * le monde a vu ce qu'il voulait voir.
 *
 * **Tout est affiché d'un coup.** La révélation était séquentielle, un boîtier
 * toutes les 1,5 s ; mais chaque diffusion de l'hôte apporte un nouveau
 * tableau `reveals`, et le spectacle repartait de zéro — la liste « se
 * rechargeait » sous les yeux de la table. Les cartes arrivent maintenant
 * ensemble, avec une seule entrée en fondu au montage, jamais rejouée.
 */
export function ResultsScreen({ view, onNextRound }: ResultsScreenProps) {
  const reduceMotion = useReducedMotion();
  const { play } = useSound();
  const reveals = view.reveals ?? [];
  const board = view.board ?? [];

  const [advancing, setAdvancing] = useState(false);

  // Un seul son pour toute la révélation : on entend si on a trouvé avant même
  // d'avoir lu les cartes. Une valeur simple plutôt que le tableau en
  // dépendance — le tableau change à chaque diffusion, le verdict non.
  const others = reveals.filter((reveal) => reveal.playerId !== view.you.id);
  const verdict: SoundName =
    others.length === 0
      ? 'reveal'
      : others.some((reveal) => reveal.guessedByPlayerIds.includes(view.you.id))
        ? 'correct'
        : 'wrong';

  // Une fois par manche, pas une fois par rendu. Un léger décalage laisse
  // passer la note de changement de phase de `PhaseShell` au lieu de la
  // couvrir ; la manche n'est marquée « jouée » que lorsque le son part.
  const soundedRound = useRef<number | null>(null);
  useEffect(() => {
    if (reveals.length === 0 || soundedRound.current === view.roundNumber) return;

    const round = view.roundNumber;
    const timer = window.setTimeout(() => {
      soundedRound.current = round;
      play(verdict);
    }, VERDICT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [view.roundNumber, reveals.length, verdict, play]);

  // Les numéros que quelqu'un portait. Tout le reste du plateau était un leurre :
  // un vote tombé dessus mérite d'être signalé comme tel, sinon on croit à une
  // erreur d'affichage.
  const ownedSlots = new Set(reveals.map((reveal) => reveal.slot));
  const isLastRound = view.roundNumber >= view.totalRounds;

  async function advance() {
    if (advancing) return;
    setAdvancing(true);
    await onNextRound();
    setAdvancing(false);
  }

  return (
    <PhaseShell view={view} title="Révélation" hideTimer>
      <PhaseAnnouncement label="Tous les personnages sont révélés." />

      {/*
        Clé stable (le joueur) et aucun `AnimatePresence` : une nouvelle vue
        pour la même manche met les cartes à jour sur place, sans les démonter
        ni rejouer leur entrée.
      */}
      <ul className="flex flex-col gap-3">
        {reveals.map((reveal) => (
          <RevealCard
            key={reveal.playerId}
            reveal={reveal}
            youId={view.you.id}
            board={board}
            ownedSlots={ownedSlots}
            animate={!reduceMotion}
          />
        ))}
      </ul>

      {view.roundScores ? (
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          aria-labelledby="points-titre"
          className="rounded-card bg-white p-4 shadow-card"
        >
          <h2
            id="points-titre"
            className="mb-3 font-display text-xs font-extrabold uppercase tracking-widest text-muted"
          >
            Points de la manche
          </h2>
          <ul className="flex flex-col gap-3">
            {view.roundScores.map((line) => (
              <li key={line.playerId}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-display text-base font-extrabold">
                    {line.nickname}
                  </span>
                  <span className="font-display text-lg font-black tabular-nums">
                    +{line.total}
                  </span>
                </div>
                <p className="text-sm text-muted">
                  Faire deviner&nbsp;: +{line.given} · Bonnes réponses&nbsp;: +{line.guessed} ·{' '}
                  <strong className="text-ink">{line.cumulative} pts au total</strong>
                </p>
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {view.you.isHost ? (
          <>
            <Button onClick={() => void advance()} disabled={advancing || view.paused === true}>
              {advancing
                ? 'Un instant…'
                : isLastRound
                  ? 'Voir le classement final'
                  : 'Manche suivante'}
            </Button>
            <p className="text-center text-sm font-semibold text-muted">
              Prenez votre temps : rien n’avance tant que tu n’as pas appuyé.
            </p>
          </>
        ) : (
          <p className="text-center text-sm font-semibold text-muted">
            {isLastRound
              ? 'L’hôte affichera le classement final quand tout le monde aura vu.'
              : 'L’hôte lancera la manche suivante quand tout le monde aura vu.'}
          </p>
        )}
      </div>
    </PhaseShell>
  );
}

// ─────────────────────────────────────────────────────────────

interface RevealCardProps {
  reveal: RoundReveal;
  youId: string;
  board: IdentityId[];
  ownedSlots: ReadonlySet<Slot>;
  /** Entrée en fondu au montage — et seulement au montage. */
  animate: boolean;
}

function RevealCard({ reveal, youId, board, ownedSlots, animate }: RevealCardProps) {
  const found = reveal.guessedByPlayerIds.length;
  const youFound = reveal.guessedByPlayerIds.includes(youId);
  const isYou = reveal.playerId === youId;
  const identityName = getIdentity(reveal.identityId)?.name ?? reveal.identityId;

  return (
    <motion.li
      initial={animate ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="rounded-card bg-white p-4 shadow-card"
    >
      {/*
        La carte dit *quoi* avant *qui* : le personnage révélé fait le titre,
        avec son portrait ; le joueur qui le portait vient en dessous, avec son
        avatar en petit. Deux ronds de même taille côte à côte se confondaient.
      */}
      <div className="flex items-center gap-3">
        <Portrait identityId={reveal.identityId} name={identityName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-display text-lg font-extrabold leading-tight">
            <span className="text-violet-dark">n°{reveal.slot}</span> {identityName}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-muted">
            <PlayerAvatar playerId={reveal.playerId} nickname={reveal.nickname} size="xs" />
            <span className="min-w-0 truncate">C’était {isYou ? 'toi' : reveal.nickname}</span>
          </p>
        </div>
      </div>

      <div className="mt-3">
        <PictoCase placed={reveal.placed} />
      </div>

      {/* ── Le dépouillement des cartes Vote ─────────────────── */}
      {reveal.votes.length > 0 ? (
        <div className="mt-3 border-t border-ink/5 pt-3">
          <p className="mb-1.5 font-display text-[0.65rem] font-extrabold uppercase tracking-widest text-muted">
            Ce que les autres ont voté
          </p>
          <ul className="flex flex-col gap-1">
            {reveal.votes.map((vote) => (
              <li
                key={vote.playerId}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="min-w-0 truncate font-semibold">
                  {vote.playerId === youId ? 'Toi' : vote.nickname}
                </span>
                <span
                  className={[
                    'shrink-0 text-right font-semibold',
                    vote.correct ? 'text-mint' : 'text-muted',
                  ].join(' ')}
                >
                  {vote.slot === null ? (
                    'sans réponse'
                  ) : (
                    <>
                      <span aria-hidden="true">{vote.correct ? '✓ ' : '✗ '}</span>
                      <span className="sr-only">{vote.correct ? 'Juste : ' : 'Faux : '}</span>
                      n°{vote.slot} {getIdentity(board[vote.slot - 1] ?? '')?.name ?? ''}
                      {!vote.correct && !ownedSlots.has(vote.slot) ? (
                        <span className="text-xs"> (leurre)</span>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="font-display text-sm font-extrabold text-violet-dark">
          {found} joueur{found > 1 ? 's' : ''} sur {reveal.possibleGuessers}{' '}
          {found > 1 ? 'ont' : 'a'} trouvé
        </p>

        {!isYou ? (
          <p
            className={[
              'rounded-full px-3 py-1 font-display text-xs font-extrabold uppercase tracking-wide',
              youFound ? 'bg-mint-light text-mint' : 'bg-pink-light text-pink',
            ].join(' ')}
          >
            {youFound ? '✓ Trouvé' : '✗ Raté'}
          </p>
        ) : null}
      </div>
    </motion.li>
  );
}
