'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getIcon,
  getIdentity,
  secondsRemaining,
  type GameError,
  type IdentityId,
  type Label,
  type PlayerView,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSound } from '@/hooks/useSound';
import { IconTile } from '@/components/ui/IconTile';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { WaitingPanel } from './WaitingPanel';

interface GuessingScreenProps {
  view: PlayerView;
  onSubmit: (guesses: Record<Label, IdentityId>) => Promise<GameError | null>;
}

const AUTO_SUBMIT_AT_SECONDS = 1;

/**
 * Appariement des séries d'indices aux identités.
 *
 * L'appariement est **bijectif** : une identité ne sert qu'une fois. Plutôt que
 * de refuser un choix déjà pris avec un message d'erreur, on **échange** les
 * deux affectations (§3.1) — c'est le geste qu'on voudrait faire de toute façon,
 * et ça évite d'imposer un « désélectionner d'abord » qui n'apprend rien.
 *
 * Le sélecteur est un `<select>` natif : sur téléphone il ouvre la roue système,
 * qui est plus rapide et plus accessible que n'importe quelle liste maison.
 */
export function GuessingScreen({ view, onSubmit }: GuessingScreenProps) {
  const { serverNow } = useServerClock();
  const { play } = useSound();

  const clueSets = useMemo(() => view.clueSets ?? [], [view.clueSets]);
  const choices = useMemo(() => view.identityChoices ?? [], [view.identityChoices]);
  const submitted = view.yourGuessesSubmitted === true;

  const [guesses, setGuesses] = useState<Record<Label, IdentityId>>(view.yourGuesses ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  const submitRef = useRef<((value: Record<Label, IdentityId>) => Promise<void>) | null>(null);

  submitRef.current = async (value: Record<Label, IdentityId>) => {
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
        // Les cases vides partent vides : elles comptent comme des réponses
        // fausses, et rien n'est rempli au hasard (§3.1).
        void submitRef.current?.(guesses);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [submitted, view.phaseEndsAt, serverNow, guesses]);

  /** Affecte une identité à une étiquette, en échangeant si elle est déjà prise. */
  function assign(label: Label, identityId: IdentityId | '') {
    if (submitted || busy) return;
    setError(null);

    setGuesses((current) => {
      const next = { ...current };

      if (identityId === '') {
        delete next[label];
        play('deselect');
        return next;
      }

      play('select');

      const heldBy = Object.keys(next).find((other) => next[other] === identityId);

      if (heldBy && heldBy !== label) {
        const displaced = next[label];
        if (displaced) next[heldBy] = displaced;
        else delete next[heldBy];
      }

      next[label] = identityId;
      return next;
    });
  }

  if (submitted) {
    return (
      <PhaseShell view={view} title="Réponses envoyées">
        <PhaseAnnouncement label="Tes réponses sont validées. On attend les autres." />

        <div className="rounded-card bg-mint-light p-5 text-center shadow-card">
          <p className="text-3xl" aria-hidden="true">
            ✅
          </p>
          <p className="mt-1 font-display text-xl font-black uppercase">Réponses envoyées !</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm font-semibold">
            {clueSets.map((clueSet) => (
              <li key={clueSet.label}>
                Joueur {clueSet.label} →{' '}
                {view.yourGuesses?.[clueSet.label]
                  ? (getIdentity(view.yourGuesses[clueSet.label]!)?.name ?? '—')
                  : 'sans réponse'}
              </li>
            ))}
          </ul>
        </div>

        <WaitingPanel view={view} verb="a validé ses réponses" />
      </PhaseShell>
    );
  }

  const complete = clueSets.every((clueSet) => guesses[clueSet.label]);
  const filled = clueSets.filter((clueSet) => guesses[clueSet.label]).length;

  return (
    <PhaseShell view={view} title="Qui est qui ?">
      <PhaseAnnouncement label="Associe chaque série d’indices à une identité." />

      <p className="text-sm font-semibold text-muted">
        Ta propre série n’est pas là, et ton identité non plus. Chaque identité ne
        sert qu’une fois.
      </p>

      <ul className="flex flex-col gap-3">
        {clueSets.map((clueSet) => {
          const selectId = `serie-${clueSet.label}`;

          return (
            <li key={clueSet.label} className="rounded-card bg-white p-4 shadow-card">
              <p className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">
                Joueur {clueSet.label}
              </p>

              <ul className="mt-2 flex flex-wrap gap-2">
                {clueSet.iconIds.map((iconId, index) => {
                  const icon = getIcon(iconId);
                  if (!icon) return null;
                  return (
                    <li key={`${clueSet.label}-${iconId}-${index}`}>
                      <IconTile icon={icon} size="sm" />
                    </li>
                  );
                })}
              </ul>

              <label htmlFor={selectId} className="sr-only">
                Identité du joueur {clueSet.label}
              </label>
              <select
                id={selectId}
                value={guesses[clueSet.label] ?? ''}
                onChange={(event) => assign(clueSet.label, event.target.value)}
                className="mt-3 min-h-[48px] w-full rounded-tile bg-violet-light px-3 font-display text-base font-extrabold text-ink"
              >
                <option value="">Choisir une identité…</option>
                {choices.map((identityId) => (
                  <option key={identityId} value={identityId}>
                    {getIdentity(identityId)?.name ?? identityId}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button
          onClick={() => void submitRef.current?.(guesses)}
          disabled={!complete || busy}
        >
          {busy ? 'Envoi…' : 'Valider mes réponses'}
        </Button>
        <p className="text-center text-sm font-semibold text-muted" aria-live="polite">
          {complete
            ? 'Tout est rempli.'
            : `${filled} / ${clueSets.length} — remplis tout pour valider.`}
        </p>
      </div>
    </PhaseShell>
  );
}
