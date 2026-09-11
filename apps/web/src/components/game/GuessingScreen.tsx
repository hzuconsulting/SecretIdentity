'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getIdentity,
  secondsRemaining,
  type GameError,
  type PlayerId,
  type PlayerView,
  type Slot,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSound } from '@/hooks/useSound';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { BoardGrid } from './BoardGrid';
import { PictoCase } from './PictoCase';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { WaitingPanel } from './WaitingPanel';

interface GuessingScreenProps {
  view: PlayerView;
  onSubmit: (votes: Record<PlayerId, Slot>) => Promise<GameError | null>;
  /** Exclusion par l'hôte, proposée depuis la liste d'attente. */
  onKick?: (playerId: PlayerId) => Promise<GameError | null>;
}

const AUTO_SUBMIT_AT_SECONDS = 1;

/**
 * Phase de vote.
 *
 * Nominative, comme dans le livret : chaque boîtier est posé devant son
 * propriétaire, et on vote en le regardant. On attribue à chacun **un numéro du
 * plateau** — les huit sont proposés, y compris ceux que personne ne porte. À
 * trois joueurs, cinq numéros sont des leurres : c'est ce qui interdit de
 * résoudre par élimination.
 *
 * Une seule contrainte, celle du matériel : on n'a **qu'une carte Vote par
 * numéro**. Plutôt que de refuser un numéro déjà attribué avec un message
 * d'erreur, on **échange** les deux votes — c'est le geste qu'on voudrait faire
 * de toute façon, et ça évite d'imposer un « désélectionner d'abord » qui
 * n'apprend rien.
 *
 * Le sélecteur est un `<select>` natif : sur téléphone il ouvre la roue système,
 * plus rapide et plus accessible que n'importe quelle liste maison.
 */
export function GuessingScreen({ view, onSubmit, onKick }: GuessingScreenProps) {
  const { serverNow } = useServerClock();
  const { play } = useSound();

  const opponents = useMemo(() => view.opponents ?? [], [view.opponents]);
  const board = useMemo(() => view.board ?? [], [view.board]);
  const submitted = view.yourVotesSubmitted === true;

  const [votes, setVotes] = useState<Record<PlayerId, Slot>>(view.yourVotes ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  const submitRef = useRef<((value: Record<PlayerId, Slot>) => Promise<void>) | null>(null);

  submitRef.current = async (value: Record<PlayerId, Slot>) => {
    if (busy || submitted) return;

    setBusy(true);
    setError(null);
    const failure = await onSubmit(value);
    if (failure) setError(failure);
    else play('confirm');
    setBusy(false);
  };

  useEffect(() => {
    if (submitted || view.phaseEndsAt === null) return;

    const interval = setInterval(() => {
      const remaining = secondsRemaining(view.phaseEndsAt, serverNow());
      if (remaining !== null && remaining <= AUTO_SUBMIT_AT_SECONDS) {
        clearInterval(interval);
        // Les cases vides partent vides : elles comptent comme des votes
        // perdus, et rien n'est rempli au hasard.
        void submitRef.current?.(votes);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [submitted, view.phaseEndsAt, serverNow, votes]);

  /** Attribue un numéro à un joueur, en échangeant s'il est déjà attribué. */
  function assign(playerId: PlayerId, raw: string) {
    if (submitted || busy) return;
    setError(null);

    setVotes((current) => {
      const next = { ...current };

      if (raw === '') {
        delete next[playerId];
        play('deselect');
        return next;
      }

      const slot = Number(raw);
      play('select');

      const heldBy = Object.keys(next).find((other) => next[other] === slot);

      if (heldBy && heldBy !== playerId) {
        const displaced = next[playerId];
        if (displaced !== undefined) next[heldBy] = displaced;
        else delete next[heldBy];
      }

      next[playerId] = slot;
      return next;
    });
  }

  if (submitted) {
    return (
      <PhaseShell view={view} title="Votes envoyés">
        <PhaseAnnouncement label="Tes votes sont validés. On attend les autres." />

        <div className="rounded-card bg-mint-light p-5 text-center shadow-card">
          <p className="text-3xl" aria-hidden="true">
            ✅
          </p>
          <p className="mt-1 font-display text-xl font-black uppercase">Votes envoyés !</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm font-semibold">
            {opponents.map((opponent) => {
              const slot = view.yourVotes?.[opponent.playerId];
              const name = slot ? getIdentity(board[slot - 1] ?? '')?.name : null;

              return (
                <li key={opponent.playerId}>
                  {opponent.nickname} → {slot ? `n°${slot} ${name ?? ''}` : 'sans réponse'}
                </li>
              );
            })}
          </ul>
        </div>

        <WaitingPanel view={view} verb="a validé ses votes" onKick={onKick} />
      </PhaseShell>
    );
  }

  const complete = opponents.every((opponent) => votes[opponent.playerId] !== undefined);
  const filled = opponents.filter((opponent) => votes[opponent.playerId] !== undefined).length;

  return (
    <PhaseShell view={view} title="Qui est qui ?">
      <PhaseAnnouncement label="Attribue un numéro du plateau à chaque joueur." />

      <BoardGrid board={board} compact />

      <p className="text-sm font-semibold text-muted">
        Attention : tous les numéros ne sont pas forcément attribués. Certains
        personnages ne correspondent à personne. Tu n’as en revanche qu’une carte Vote
        par numéro.
      </p>

      <ul className="flex flex-col gap-3">
        {opponents.map((opponent) => {
          const selectId = `vote-${opponent.playerId}`;

          return (
            <li key={opponent.playerId} className="rounded-card bg-white p-4 shadow-card">
              <div className="flex items-center gap-3">
                <PlayerAvatar
                  playerId={opponent.playerId}
                  nickname={opponent.nickname}
                  size="sm"
                />
                <p className="min-w-0 flex-1 truncate font-display text-lg font-extrabold">
                  {opponent.nickname}
                </p>
              </div>

              <div className="mt-3">
                <PictoCase placed={opponent.placed} />
              </div>

              <label htmlFor={selectId} className="sr-only">
                Numéro du personnage de {opponent.nickname}
              </label>
              <select
                id={selectId}
                value={votes[opponent.playerId] ?? ''}
                onChange={(event) => assign(opponent.playerId, event.target.value)}
                className="mt-3 min-h-[48px] w-full rounded-tile bg-violet-light px-3 font-display text-base font-extrabold text-ink"
              >
                <option value="">Choisir un numéro…</option>
                {board.map((identityId, index) => (
                  <option key={`${index}-${identityId}`} value={index + 1}>
                    {index + 1} — {getIdentity(identityId)?.name ?? identityId}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button onClick={() => void submitRef.current?.(votes)} disabled={!complete || busy}>
          {busy ? 'Envoi…' : 'Valider mes votes'}
        </Button>
        <p className="text-center text-sm font-semibold text-muted" aria-live="polite">
          {complete
            ? 'Tout est rempli.'
            : `${filled} / ${opponents.length} — remplis tout pour valider.`}
        </p>
      </div>
    </PhaseShell>
  );
}
