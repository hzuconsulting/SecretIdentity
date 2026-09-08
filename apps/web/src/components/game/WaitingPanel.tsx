'use client';

import type { PlayerView } from '@identite-secrete/shared';

interface WaitingPanelProps {
  view: PlayerView;
  /** Ce que le joueur a fait, à la troisième personne : « a validé ses indices ». */
  verb: string;
}

/**
 * Écran d'attente.
 *
 * La progression est volontairement pauvre : un booléen par joueur, jamais le
 * contenu de sa sélection. C'est une contrainte du §4.4, et c'est aussi ce
 * qu'on veut à l'écran — savoir qui manque, pas ce qu'il a choisi.
 */
export function WaitingPanel({ view, verb }: WaitingPanelProps) {
  const progress = view.progress ?? [];
  const done = progress.filter((entry) => entry.submitted).length;
  const waiting = progress.filter((entry) => !entry.submitted);

  return (
    <section aria-labelledby="attente-titre" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="attente-titre"
          className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
        >
          {waiting.length === 0 ? 'Tout le monde est prêt' : 'On attend encore'}
        </h2>
        <p className="font-display text-sm font-extrabold tabular-nums" aria-live="polite">
          {done} / {progress.length}
        </p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {progress.map((entry) => (
          <li
            key={entry.playerId}
            className="flex items-center gap-2 rounded-tile bg-white px-4 py-2.5 text-sm font-semibold shadow-tile"
          >
            <span aria-hidden="true">{entry.submitted ? '✅' : '⏳'}</span>
            <span className={entry.submitted ? '' : 'text-muted'}>
              {entry.nickname} {entry.submitted ? verb : 'réfléchit encore'}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-center text-sm font-semibold text-muted">
        {waiting.length === 0
          ? 'On enchaîne dans un instant.'
          : 'La phase se termine dès que tout le monde a validé, ou à la fin du décompte.'}
      </p>
    </section>
  );
}
