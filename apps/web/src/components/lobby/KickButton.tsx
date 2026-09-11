'use client';

import { useState } from 'react';
import type { GameError, PlayerId } from '@identite-secrete/shared';

interface KickButtonProps {
  playerId: PlayerId;
  nickname: string;
  onKick: (playerId: PlayerId) => Promise<GameError | null>;
  /** Texte de confirmation, adapté au contexte (salon ou manche en cours). */
  warning?: string;
}

/**
 * Exclusion d'un joueur, en deux temps.
 *
 * Le geste est irréversible et vise quelqu'un : il ne peut pas tenir dans une
 * seule tape sur une croix de neuf pixels, à côté d'une liste où l'on tape déjà
 * pour d'autres raisons. La confirmation est portée par le bouton lui-même —
 * pas par une boîte de dialogue système, qui sur mobile arrive trop tard et se
 * valide par réflexe.
 */
export function KickButton({ playerId, nickname, onKick, warning }: KickButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    await onKick(playerId);
    // Pas de `setBusy(false)` en cas de succès : le joueur disparaît de la liste
    // avec ce composant. En cas d'échec, la vue reste et le bouton doit revivre.
    setBusy(false);
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Exclure ${nickname}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-light font-display text-base font-extrabold text-muted transition-colors hover:bg-pink-light hover:text-pink"
      >
        <span aria-hidden="true">✕</span>
      </button>
    );
  }

  return (
    <div className="mt-3 w-full border-t border-ink/5 pt-3">
      <p className="text-sm font-semibold">
        Exclure {nickname} ?{warning ? ` ${warning}` : ''}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-tile bg-violet-light px-4 font-display text-sm font-extrabold uppercase tracking-wide text-violet-dark"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-tile bg-pink px-4 font-display text-sm font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
        >
          {busy ? 'Exclusion…' : 'Exclure'}
        </button>
      </div>
    </div>
  );
}
