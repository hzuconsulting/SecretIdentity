'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  REVEAL_STEP_MS,
  getIcon,
  getIdentity,
  type PlayerView,
  type RevealedClueSet,
} from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import { IconTile } from '@/components/ui/IconTile';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';

/**
 * Révélation séquentielle.
 *
 * Une série toutes les 1,5 s, dans l'ordre — c'est le moment de la manche où
 * tout le monde regarde le même écran, et tout révéler d'un coup gâcherait le
 * seul suspense du jeu. Chaque carte se dévoile en trois temps : les icônes,
 * puis l'identité, puis l'auteur.
 *
 * Avec `prefers-reduced-motion`, tout s'affiche immédiatement : l'information
 * est la même, seule la mise en scène disparaît.
 */
export function ResultsScreen({ view }: { view: PlayerView }) {
  const reduceMotion = useReducedMotion();
  const { play } = useSound();
  const reveals = view.reveals ?? [];

  const [shown, setShown] = useState(() => (reduceMotion ? reveals.length : 0));

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

  return (
    <PhaseShell view={view} title="Révélation">
      <PhaseAnnouncement
        label={
          allShown
            ? 'Toutes les identités sont révélées.'
            : 'Les identités se révèlent une par une.'
        }
      />

      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {visible.map((reveal) => (
            <RevealCard key={reveal.label} reveal={reveal} youId={view.you.id} />
          ))}
        </AnimatePresence>
      </ul>

      {!allShown ? (
        <p className="text-center text-sm font-semibold text-muted">
          {shown} / {reveals.length}
        </p>
      ) : null}

      {allShown && view.roundScores ? (
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          aria-label="Points de la manche"
          className="rounded-card bg-white p-4 shadow-card"
        >
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
                  Faire deviner&nbsp;: +{line.given} · Bonnes réponses&nbsp;: +{line.guessed}
                </p>
              </li>
            ))}
          </ul>
        </motion.section>
      ) : null}
    </PhaseShell>
  );
}

function RevealCard({ reveal, youId }: { reveal: RevealedClueSet; youId: string }) {
  const found = reveal.guessedByPlayerIds.length;
  const youFound = reveal.guessedByPlayerIds.includes(youId);
  const isYou = reveal.playerId === youId;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-card bg-white p-4 shadow-card"
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar playerId={reveal.playerId} nickname={reveal.nickname} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-extrabold leading-tight">
            {getIdentity(reveal.identityId)?.name ?? reveal.identityId}
          </p>
          <p className="text-sm font-semibold text-muted">
            Joueur {reveal.label} — c’était {isYou ? 'toi' : reveal.nickname}
          </p>
        </div>
      </div>

      {reveal.iconIds.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {reveal.iconIds.map((iconId, index) => {
            const icon = getIcon(iconId);
            if (!icon) return null;
            return (
              <li key={`${reveal.label}-${iconId}-${index}`}>
                <IconTile icon={icon} selectionIndex={index + 1} size="sm" />
              </li>
            );
          })}
        </ul>
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
