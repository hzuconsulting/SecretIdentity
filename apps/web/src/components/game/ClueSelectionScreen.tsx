'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MIN_CLUES,
  TIMER_URGENT_SECONDS,
  getIcon,
  getIdentity,
  secondsRemaining,
  type GameError,
  type IconId,
  type PlayerView,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSound } from '@/hooks/useSound';
import { IconTile } from '@/components/ui/IconTile';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { IdentityCard } from './IdentityCard';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { WaitingPanel } from './WaitingPanel';

interface ClueSelectionScreenProps {
  view: PlayerView;
  onSubmit: (iconIds: IconId[]) => Promise<GameError | null>;
}

/** Marge avant l'échéance à laquelle le client valide tout seul. */
const AUTO_SUBMIT_AT_SECONDS = 1;

/**
 * Sélection des indices.
 *
 * Deux garde-fous côté interface, en plus de la validation serveur :
 *  - la sélection est signalée par une bordure **et** une pastille numérotée,
 *    jamais par la couleur seule (§7.4) ;
 *  - la validation demande une confirmation, parce qu'elle est définitive.
 *
 * À une seconde de la fin, le client valide automatiquement la sélection en
 * cours. Ce n'est pas une décision de phase — le serveur reste seul maître du
 * temps — mais une action du joueur, envoyée à sa place. La marge d'une
 * seconde laisse à la requête le temps d'arriver avant l'échéance ; si elle
 * n'y arrive pas, ou si le joueur est déconnecté, le serveur tire une icône
 * de sa main.
 */
export function ClueSelectionScreen({ view, onSubmit }: ClueSelectionScreenProps) {
  const { serverNow } = useServerClock();
  const { play } = useSound();

  const [selected, setSelected] = useState<IconId[]>(view.yourSelectedIcons ?? []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  const hand = useMemo(() => view.yourHand ?? [], [view.yourHand]);
  const identity = view.yourIdentityId ? getIdentity(view.yourIdentityId) : undefined;
  const submitted = view.yourCluesSubmitted === true;
  const maxClues = view.settings.maxClues;

  // `submit` est appelé depuis un minuteur : on passe par une référence pour
  // que l'effet d'auto-validation n'ait pas à se réabonner à chaque frappe.
  const submitRef = useRef<((iconIds: IconId[]) => Promise<void>) | null>(null);

  submitRef.current = async (iconIds: IconId[]) => {
    if (busy || submitted || iconIds.length < MIN_CLUES) return;

    setBusy(true);
    setError(null);
    const failure = await onSubmit(iconIds);
    if (failure) setError(failure);
    else play('confirm');
    setBusy(false);
    setConfirming(false);
  };

  useEffect(() => {
    if (submitted || view.phaseEndsAt === null) return;

    const interval = setInterval(() => {
      const remaining = secondsRemaining(view.phaseEndsAt, serverNow());
      if (remaining !== null && remaining <= AUTO_SUBMIT_AT_SECONDS) {
        clearInterval(interval);
        void submitRef.current?.(selected);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [submitted, view.phaseEndsAt, serverNow, selected]);

  function toggle(iconId: IconId) {
    if (submitted || busy) return;

    setError(null);
    setSelected((current) => {
      if (current.includes(iconId)) {
        play('deselect');
        return current.filter((id) => id !== iconId);
      }
      // Silencieusement ignoré au-delà du maximum : un message d'erreur pour
      // un simple appui de trop serait plus agaçant qu'utile. Le compteur dit
      // déjà que la main est pleine.
      if (current.length >= maxClues) return current;
      play('select');
      return [...current, iconId];
    });
  }

  if (submitted) {
    return (
      <PhaseShell view={view} title="Indices validés">
        <PhaseAnnouncement label="Tes indices sont validés. On attend les autres." />

        <div className="rounded-card bg-mint-light p-5 text-center shadow-card">
          <p className="text-3xl" aria-hidden="true">
            ✅
          </p>
          <p className="mt-1 font-display text-xl font-black uppercase">Indices validés !</p>
          <ul className="mt-4 flex justify-center gap-2">
            {(view.yourSelectedIcons ?? []).map((iconId, index) => {
              const icon = getIcon(iconId);
              if (!icon) return null;
              return (
                <li key={iconId}>
                  <IconTile icon={icon} selectionIndex={index + 1} size="sm" />
                </li>
              );
            })}
          </ul>
        </div>

        <WaitingPanel view={view} verb="a validé ses indices" />
      </PhaseShell>
    );
  }

  const remaining = secondsRemaining(view.phaseEndsAt, serverNow());
  const urgent = remaining !== null && remaining <= TIMER_URGENT_SECONDS;

  return (
    <PhaseShell view={view} title="Tes indices">
      <PhaseAnnouncement label="Choisis les icônes qui font deviner ton identité." />

      <IdentityCard identityName={identity?.name ?? '—'} compact />

      <section aria-labelledby="main-titre">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2
            id="main-titre"
            className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
          >
            Ta main
          </h2>
          <p
            className="font-display text-sm font-extrabold tabular-nums"
            aria-live="polite"
          >
            {selected.length} / {maxClues} indice{maxClues > 1 ? 's' : ''} sélectionné
            {selected.length > 1 ? 's' : ''}
          </p>
        </div>

        <ul className="grid grid-cols-4 justify-items-center gap-3">
          {hand.map((iconId) => {
            const icon = getIcon(iconId);
            if (!icon) return null;

            const position = selected.indexOf(iconId);
            const isSelected = position !== -1;
            const full = selected.length >= maxClues && !isSelected;

            return (
              <li key={iconId}>
                <button
                  type="button"
                  onClick={() => toggle(iconId)}
                  aria-pressed={isSelected}
                  aria-label={
                    isSelected
                      ? `${icon.label}, indice ${position + 1}, appuie pour retirer`
                      : `${icon.label}, appuie pour choisir`
                  }
                  className={[
                    'rounded-tile transition-transform duration-150 active:scale-95',
                    full ? 'opacity-40' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <IconTile
                    icon={icon}
                    selectionIndex={isSelected ? position + 1 : null}
                    size="sm"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <AnimatePresence mode="wait">
          {confirming ? (
            <motion.div
              key="confirmation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-card bg-white p-4 shadow-card"
            >
              <p className="text-center font-display text-base font-extrabold">
                Confirmer ces indices&nbsp;?
              </p>
              <p className="mt-1 text-center text-sm font-semibold text-muted">
                Tu ne pourras plus les changer.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="soft"
                  size="md"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Modifier
                </Button>
                <Button
                  size="md"
                  onClick={() => void submitRef.current?.(selected)}
                  disabled={busy}
                >
                  {busy ? 'Envoi…' : 'Confirmer'}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="validation" initial={false}>
              <Button
                onClick={() => setConfirming(true)}
                disabled={selected.length < MIN_CLUES || busy}
                variant={urgent ? 'accent' : 'primary'}
              >
                Valider mes indices
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-sm font-semibold text-muted">
          {selected.length < MIN_CLUES
            ? 'Choisis au moins une icône.'
            : 'Sans validation, tes indices partiront tout seuls à la fin du temps.'}
        </p>
      </div>
    </PhaseShell>
  );
}
