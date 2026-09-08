'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { getIdentity, type PlayerView } from '@identite-secrete/shared';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { IdentityCard } from './IdentityCard';

/**
 * « Ton identité ».
 *
 * Cinq secondes, une seule information à l'écran, en très gros. C'est le
 * moment le plus sensible du jeu : le téléphone est visible par les voisins,
 * d'où le bouton de masquage porté par `IdentityCard`.
 */
export function IdentityRevealScreen({ view }: { view: PlayerView }) {
  const reduceMotion = useReducedMotion();
  const identity = view.yourIdentityId ? getIdentity(view.yourIdentityId) : undefined;

  return (
    <PhaseShell view={view} title="Ton identité">
      <PhaseAnnouncement label="Découvre ton identité secrète." />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-1 flex-col justify-center gap-6"
      >
        <IdentityCard identityName={identity?.name ?? '—'} />

        <p className="text-center text-base font-semibold text-muted">
          Fais deviner cette identité avec tes icônes. Sans parler, sans écrire,
          sans mimer.
        </p>
      </motion.div>
    </PhaseShell>
  );
}
