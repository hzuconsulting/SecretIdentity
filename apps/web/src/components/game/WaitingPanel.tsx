'use client';

import type { GameError, PlayerId, PlayerView } from '@identite-secrete/shared';
import { KickButton } from '@/components/lobby/KickButton';

interface WaitingPanelProps {
  view: PlayerView;
  /** Ce que le joueur a fait, à la troisième personne : « a validé son boîtier ». */
  verb: string;
  onKick?: (playerId: PlayerId) => Promise<GameError | null>;
}

/**
 * Écran d'attente.
 *
 * La progression est volontairement pauvre : un booléen par joueur, jamais le
 * contenu de son boîtier. C'est une contrainte du §4.4, et c'est aussi ce
 * qu'on veut à l'écran — savoir qui manque, pas ce qu'il a choisi.
 *
 * C'est aussi le seul endroit, en cours de partie, où l'hôte a la liste des
 * joueurs sous les yeux : c'est donc là que vit l'exclusion pendant une manche.
 */
export function WaitingPanel({ view, verb, onKick }: WaitingPanelProps) {
  const progress = view.progress ?? [];
  const done = progress.filter((entry) => entry.submitted).length;
  const waiting = progress.filter((entry) => !entry.submitted);
  // Seul l'hôte exclut. On résout le droit une fois pour toutes plutôt que de
  // le retester à chaque ligne.
  const kickHandler = view.you.isHost ? onKick : undefined;

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
            className="flex flex-wrap items-center gap-2 rounded-tile bg-white px-4 py-2.5 text-sm font-semibold shadow-tile"
          >
            <span aria-hidden="true">{entry.submitted ? '✅' : '⏳'}</span>
            <span className={['min-w-0 flex-1', entry.submitted ? '' : 'text-muted'].join(' ')}>
              {entry.nickname} {entry.submitted ? verb : 'réfléchit encore'}
            </span>

            {kickHandler && entry.playerId !== view.you.id ? (
              <KickButton
                playerId={entry.playerId}
                nickname={entry.nickname}
                onKick={kickHandler}
                warning="La manche se termine sans cette personne."
              />
            ) : null}
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
