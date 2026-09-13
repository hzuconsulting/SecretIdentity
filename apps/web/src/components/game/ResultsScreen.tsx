'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  REVEAL_STEP_MS,
  getIdentity,
  type IdentityId,
  type PlayerView,
  type RoundReveal,
  type Slot,
} from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import { Button } from '@/components/ui/Button';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PictoCase } from './PictoCase';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { Portrait } from './Portrait';

interface ResultsScreenProps {
  view: PlayerView;
  onNextRound: () => Promise<unknown>;
}

/**
 * Fin de manche : tout est révélé, et on prend son temps.
 *
 * **Pas de minuteur.** C'est le moment où la table discute — « tu m'as pris pour
 * Hercule ? », « mais le rouge voulait dire *pas* un enfant ! » — et un décompte
 * coupait la conversation au milieu. L'hôte lance la manche suivante quand tout
 * le monde a vu ce qu'il voulait voir.
 *
 * La révélation reste séquentielle, un boîtier toutes les 1,5 s : c'est la seule
 * mise en scène du jeu, et tout montrer d'un coup gâcherait le suspense. Mais
 * ce n'est qu'une animation — rien n'avance tout seul après. Avec
 * `prefers-reduced-motion`, tout s'affiche immédiatement.
 */
export function ResultsScreen({ view, onNextRound }: ResultsScreenProps) {
  const reduceMotion = useReducedMotion();
  const { play } = useSound();
  const reveals = view.reveals ?? [];
  const board = view.board ?? [];

  const [shown, setShown] = useState(() => (reduceMotion ? reveals.length : 0));
  const [advancing, setAdvancing] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      setShown(reveals.length);
      return;
    }

    setShown(0);
    const interval = setInterval(() => {
      setShown((current) => {
        if (current >= reveals.length) {
          clearInterval(interval);
          return current;
        }

        // Le son dépend de ce que la carte annonce : on entend si on a trouvé
        // avant même d'avoir lu la carte.
        const reveal = reveals[current];
        if (reveal) {
          const isMine = reveal.playerId === view.you.id;
          if (isMine) play('reveal');
          else play(reveal.guessedByPlayerIds.includes(view.you.id) ? 'correct' : 'wrong');
        }

        return current + 1;
      });
    }, REVEAL_STEP_MS);

    return () => clearInterval(interval);
  }, [reveals, reduceMotion, play, view.you.id]);

  const visible = reveals.slice(0, shown);
  const allShown = shown >= reveals.length;

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
      <PhaseAnnouncement
        label={
          allShown
            ? 'Tous les personnages sont révélés.'
            : 'Les personnages se révèlent un par un.'
        }
      />

      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {visible.map((reveal) => (
            <RevealCard
              key={reveal.playerId}
              reveal={reveal}
              youId={view.you.id}
              board={board}
              ownedSlots={ownedSlots}
            />
          ))}
        </AnimatePresence>
      </ul>

      {!allShown ? (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-semibold text-muted">
            {shown} / {reveals.length}
          </p>
          <button
            type="button"
            onClick={() => setShown(reveals.length)}
            className="min-h-[44px] font-display text-xs font-extrabold uppercase tracking-widest text-violet"
          >
            Tout révéler
          </button>
        </div>
      ) : null}

      {allShown && view.roundScores ? (
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

      {allShown ? (
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
      ) : null}
    </PhaseShell>
  );
}

// ─────────────────────────────────────────────────────────────

interface RevealCardProps {
  reveal: RoundReveal;
  youId: string;
  board: IdentityId[];
  ownedSlots: ReadonlySet<Slot>;
}

function RevealCard({ reveal, youId, board, ownedSlots }: RevealCardProps) {
  const found = reveal.guessedByPlayerIds.length;
  const youFound = reveal.guessedByPlayerIds.includes(youId);
  const isYou = reveal.playerId === youId;
  const identityName = getIdentity(reveal.identityId)?.name ?? reveal.identityId;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
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
