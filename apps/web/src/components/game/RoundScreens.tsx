'use client';

import { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { type PlayerView, type RoundScoreLine } from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';

/**
 * Classement de fin de manche et écran de fin de partie.
 *
 * Les autres phases ont chacune leur fichier : `ClueSelectionScreen`,
 * `GuessingScreen`, `ResultsScreen`, `IdentityRevealScreen`.
 */

// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────

interface ScoreboardScreenProps {
  view: PlayerView;
  onNextRound: () => Promise<unknown>;
}

export function ScoreboardScreen({ view, onNextRound }: ScoreboardScreenProps) {
  const standings = view.standings ?? [];
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <PhaseShell view={view} title="Classement">
      <PhaseAnnouncement label="Classement de la manche." />

      <ol className="flex flex-col gap-2">
        {standings.map((line, index) => (
          <motion.li
            key={line.playerId}
            // `layout` anime le déplacement d'un joueur qui change de rang :
            // c'est l'information la plus intéressante du classement.
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.06, duration: 0.25 }}
            className="flex items-center gap-3 rounded-tile bg-white px-4 py-3 shadow-tile"
          >
            <span className="w-7 text-center text-xl" aria-hidden="true">
              {medals[index] ?? index + 1}
            </span>
            <PlayerAvatar playerId={line.playerId} nickname={line.nickname} size="sm" />
            <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold">
              {line.nickname}
            </span>
            <span className="font-display text-xl font-black tabular-nums">
              {line.cumulative}
            </span>
          </motion.li>
        ))}
      </ol>

      {view.you.isHost ? (
        <button
          type="button"
          onClick={() => void onNextRound()}
          className="mt-auto min-h-[56px] w-full rounded-tile bg-violet px-6 font-display text-lg font-extrabold uppercase tracking-wide text-white shadow-tile active:translate-y-1 active:shadow-tile-active"
        >
          Manche suivante
        </button>
      ) : (
        <p className="mt-auto text-center text-sm font-semibold text-muted">
          La manche suivante démarre toute seule dans quelques secondes.
        </p>
      )}
    </PhaseShell>
  );
}

// ─────────────────────────────────────────────────────────────

interface FinalResultsScreenProps {
  view: PlayerView;
  onReplay: () => Promise<unknown>;
  onLeave: () => Promise<void>;
}

export function FinalResultsScreen({ view, onReplay, onLeave }: FinalResultsScreenProps) {
  const reduceMotion = useReducedMotion();
  const { play } = useSound();
  const standings = view.standings ?? [];
  const winner = standings[0];
  const stats = view.stats;

  useEffect(() => {
    play('win');
  }, [play]);

  return (
    <PhaseShell view={view} title="Fin de partie" hideTimer>
      <PhaseAnnouncement label="La partie est terminée." />

      {winner ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="rounded-card bg-ink p-6 text-center shadow-card"
        >
          <motion.p
            className="text-4xl"
            aria-hidden="true"
            animate={reduceMotion ? {} : { rotate: [0, -8, 8, 0] }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            🏆
          </motion.p>
          <p className="mt-2 font-display text-3xl font-black text-white">
            {winner.nickname}
          </p>
          <p className="font-display text-sm font-extrabold uppercase tracking-widest text-sun">
            {winner.cumulative} points
          </p>
        </motion.div>
      ) : null}

      <ScoreTable lines={standings} />

      {stats ? (
        <ul className="flex flex-col gap-2">
          {stats.bestDetective ? (
            <StatLine
              label="Meilleur détective"
              value={`${stats.bestDetective.nickname} · ${stats.bestDetective.correctGuesses} identités trouvées`}
            />
          ) : null}
          {stats.bestCluegiver ? (
            <StatLine
              label="Meilleur créateur d’indices"
              value={`${stats.bestCluegiver.nickname} · ${Math.round(stats.bestCluegiver.successRate * 100)} % de réussite`}
            />
          ) : null}
          {stats.hardestIdentity ? (
            <StatLine
              label="Indice incompris"
              value={`${stats.hardestIdentity.nickname} · ${Math.round(stats.hardestIdentity.successRate * 100)} % de réussite`}
            />
          ) : null}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {view.you.isHost ? (
          <button
            type="button"
            onClick={() => void onReplay()}
            className="min-h-[56px] w-full rounded-tile bg-violet px-6 font-display text-lg font-extrabold uppercase tracking-wide text-white shadow-tile active:translate-y-1 active:shadow-tile-active"
          >
            Rejouer
          </button>
        ) : (
          <p className="text-center text-sm font-semibold text-muted">
            L’hôte peut relancer une partie avec les mêmes joueurs.
          </p>
        )}

        <button
          type="button"
          onClick={() => void onLeave()}
          className="min-h-[48px] w-full rounded-tile bg-white px-6 font-display text-base font-extrabold uppercase tracking-wide shadow-tile active:translate-y-1 active:shadow-tile-active"
        >
          Nouvelle partie
        </button>
      </div>
    </PhaseShell>
  );
}

// ─────────────────────────────────────────────────────────────
//  Fragments partagés
// ─────────────────────────────────────────────────────────────

function ScoreTable({ lines }: { lines: RoundScoreLine[] }) {
  return (
    <section aria-label="Points de la manche" className="rounded-card bg-white p-4 shadow-card">
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.playerId} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-display text-base font-extrabold">
                {line.nickname}
              </span>
              <span className="font-display font-black tabular-nums">
                {line.cumulative} pts
              </span>
            </div>
            <p className="text-muted">
              Faire deviner&nbsp;: +{line.given} · Bonnes réponses&nbsp;: +{line.guessed} ·
              Total&nbsp;: +{line.total}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-tile bg-white px-4 py-3 shadow-tile">
      <p className="font-display text-[0.65rem] font-extrabold uppercase tracking-widest text-muted">
        {label}
      </p>
      <p className="font-display text-base font-extrabold">{value}</p>
    </li>
  );
}
