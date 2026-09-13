'use client';

import { useEffect, type ReactNode } from 'react';
import type { PlayerView } from '@identite-secrete/shared';
import { useSound } from '@/hooks/useSound';
import { GameChromeBar } from './GameChrome';
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
 * Il porte les repères dont on a besoin en permanence : le code de la partie
 * (pour qui doit revenir), les règles, le son et le menu — c'est la barre du
 * haut, fournie par `GameChrome` — puis où on en est dans la partie et combien
 * de temps il reste. Le contenu propre à la phase vit dans `children`.
 *
 * « Règles » ouvre un panneau **par-dessus** l'écran : rien n'est démonté, un
 * boîtier en cours de remplissage est intact à la fermeture.
 */
export function PhaseShell({ view, title, children, hideTimer = false }: PhaseShellProps) {
  const { play } = useSound();

  // Une note courte à chaque changement de phase : sur une table de six
  // téléphones, c'est ce qui fait lever les yeux en même temps.
  useEffect(() => {
    play('phase');
  }, [view.phase, view.roundNumber, play]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="flex flex-col gap-4">
        <GameChromeBar />

        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">
              Manche {view.roundNumber} / {view.totalRounds}
            </p>
            <h1 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
              {title}
            </h1>
          </div>

          {hideTimer ? null : (
            <div className="shrink-0">
              <Timer phaseEndsAt={view.phaseEndsAt} />
            </div>
          )}
        </header>
      </div>

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
