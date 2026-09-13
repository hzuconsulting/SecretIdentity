'use client';

import { Sheet } from '@/components/game/Sheet';
import { RulesContent } from './RulesContent';

interface RulesSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Les règles, consultées **sans quitter la partie**.
 *
 * Avant, « Règles » menait à `/comment-jouer` : l'écran de jeu se démontait,
 * le boîtier en cours était perdu, et la page n'offrait qu'un retour à
 * l'accueil — d'où l'on ne retrouvait plus la partie. Le panneau se pose
 * par-dessus l'écran de phase, qui reste monté derrière.
 */
export function RulesSheet({ open, onClose }: RulesSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Comment jouer ?">
      <RulesContent headingLevel={3} />
      <button
        type="button"
        onClick={onClose}
        className="mt-6 min-h-[56px] w-full rounded-tile bg-violet px-6 font-display text-lg font-extrabold uppercase tracking-wide text-white shadow-tile active:translate-y-1 active:shadow-tile-active"
      >
        Retour à la partie
      </button>
    </Sheet>
  );
}
