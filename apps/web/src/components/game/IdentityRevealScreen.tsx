'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { getIdentity, type PlayerView } from '@identite-secrete/shared';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { BoardGrid } from './BoardGrid';
import { IdentityCard } from './IdentityCard';

/**
 * « Ta carte Mystère ».
 *
 * Deux informations, dans cet ordre : le personnage qu'on doit faire deviner, et
 * le plateau où il se cache parmi sept autres. C'est le moment le plus sensible
 * du jeu — le téléphone est visible par les voisins — d'où le bouton de masquage
 * porté par `IdentityCard`.
 *
 * Le plateau est affiché **sans** mettre en avant son propre numéro : la mise en
 * avant trahirait le secret au premier regard de travers, alors que la liste des
 * huit personnages, elle, est publique.
 */
export function IdentityRevealScreen({ view }: { view: PlayerView }) {
  const reduceMotion = useReducedMotion();
  const identity = view.yourIdentityId ? getIdentity(view.yourIdentityId) : undefined;

  return (
    <PhaseShell view={view} title="Ta carte Mystère">
      <PhaseAnnouncement label="Découvre le personnage que tu dois faire deviner." />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col gap-5"
      >
        <IdentityCard
          identityName={identity?.name ?? '—'}
          slot={view.yourSlot ?? null}
        />

        {view.board ? <BoardGrid board={view.board} compact /> : null}

        <p className="text-center text-base font-semibold text-muted">
          Fais deviner ce personnage avec tes pictogrammes. Sans parler, sans écrire,
          sans mimer.
        </p>
      </motion.div>
    </PhaseShell>
  );
}
