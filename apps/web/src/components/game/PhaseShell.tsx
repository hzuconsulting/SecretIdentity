'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import type { PlayerView } from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import { SoundToggle } from '@/components/ui/SoundToggle';
import { Timer } from './Timer';

interface PhaseShellProps {
  view: PlayerView;
  /** Titre de la phase, court et impératif. */
  title: string;
  children: ReactNode;
  /** Masque le décompte, par exemple sur l'écran de fin de partie. */
  hideTimer?: boolean;
}

/**
 * Cadre commun à tous les écrans de manche.
 *
 * Il porte les trois repères dont on a besoin en permanence : où on en est
 * dans la partie, combien de temps il reste, et comment retrouver les règles.
 * Le contenu propre à la phase vit dans `children`.
 */
export function PhaseShell({ view, title, children, hideTimer = false }: PhaseShellProps) {
  const { play } = useSound();

  // Une note courte à chaque changement de phase : sur une table de six
  // téléphones, c'est ce qui fait lever les yeux en même temps.
  useEffect(() => {
    play('phase');
  }, [view.phase, view.roundNumber, play]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">
            Manche {view.roundNumber} / {view.totalRounds}
          </p>
          <h1 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            {hideTimer ? null : <Timer phaseEndsAt={view.phaseEndsAt} />}
            <Link
              href="/comment-jouer"
              className="font-display text-[0.65rem] font-extrabold uppercase tracking-widest text-violet"
            >
              Règles
            </Link>
          </div>
          <SoundToggle />
        </div>
      </header>

      {children}
    </main>
  );
}

/**
 * Annonce de changement de phase pour les lecteurs d'écran.
 * Le changement visuel est évident à l'œil ; il ne l'est pas à l'oreille.
 */
export function PhaseAnnouncement({ label }: { label: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {label}
    </p>
  );
}
