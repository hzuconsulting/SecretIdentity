'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
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
 *
 * **Le décompte ne quitte jamais l'écran.** Le boîtier et le vote se jouent en
 * faisant défiler une longue page ; le titre et le minuteur restent collés en
 * haut (`sticky`), sous l'encoche, pendant que la barre du code s'en va avec
 * le reste. Le panneau des règles, la pause et les toasts passent au-dessus.
 */
export function PhaseShell({ view, title, children, hideTimer = false }: PhaseShellProps) {
  const { play } = useSound();
  const headerRef = useRef<HTMLElement>(null);
  const stuck = useStuck(headerRef, !hideTimer);

  // Une note courte à chaque changement de phase : sur une table de six
  // téléphones, c'est ce qui fait lever les yeux en même temps.
  useEffect(() => {
    play('phase');
  }, [view.phase, view.roundNumber, play]);

  // Chaque phase commence en haut de page. Sans cela, on arrivait sur « Ton
  // boîtier » déjà descendu à l'endroit où l'on avait touché « Lancer la
  // partie », sans voir sa carte ni le haut du boîtier.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.phase, view.roundNumber]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <GameChromeBar />

      {/*
        L'en-tête est un enfant direct de `main` : un élément `sticky` ne colle
        que dans les limites de son parent. Il déborde de la marge de la colonne
        (`-mx-5 px-5`) pour que son fond couvre toute la largeur une fois collé ;
        les marges négatives verticales compensent son rembourrage, et l'écart
        avec la barre du code reste celui d'avant.
      */}
      <header
        ref={headerRef}
        className={[
          '-mx-5 -mb-2 -mt-3 flex items-end justify-between gap-3 px-5 py-2',
          hideTimer
            ? ''
            : 'sticky top-[env(safe-area-inset-top)] z-30 transition-[background-color,box-shadow] duration-200',
          // Fond et ombre seulement une fois collé : au repos, l'en-tête se
          // fond dans la page comme avant. Le pseudo-élément couvre la bande de
          // l'encoche au-dessus, où le contenu défilerait sinon à découvert.
          stuck
            ? 'bg-lilac/90 shadow-[0_12px_20px_-16px_rgba(48,20,130,0.45)] backdrop-blur-md before:absolute before:inset-x-0 before:bottom-full before:h-[env(safe-area-inset-top)] before:bg-lilac/90'
            : '',
        ].join(' ')}
      >
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

      {children}
    </main>
  );
}

/**
 * `true` quand l'élément `sticky` est collé en haut de l'écran.
 *
 * CSS ne sait pas le dire : on compare sa position à son `top` calculé (la
 * hauteur de l'encoche, en pixels), une fois par image au plus pendant le
 * défilement.
 */
function useStuck(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element) {
      setStuck(false);
      return;
    }

    let frame = 0;
    const measure = () => {
      frame = 0;
      const offset = Number.parseFloat(getComputedStyle(element).top) || 0;
      setStuck(window.scrollY > 0 && element.getBoundingClientRect().top <= offset + 1);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [ref, enabled]);

  return stuck;
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
