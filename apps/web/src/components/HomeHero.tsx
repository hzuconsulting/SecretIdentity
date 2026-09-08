'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { getIcon } from '@identite-secrete/shared';
import { IconTile } from '@/components/ui/IconTile';

/**
 * Le héros de l'accueil, c'est la mécanique du jeu montrée telle quelle :
 * une identité secrète, et la série d'icônes censée la faire deviner.
 * Ici « Cléopâtre » se lit par : couronne, serpent, désert, œil, diamant.
 */
const CLUE_ICON_IDS = ['crown', 'snake', 'desert', 'eye', 'gem'] as const;
const ANGLES = [-13, -6.5, 0, 6.5, 13];
const LIFTS = [16, 4, 0, 4, 16];

export function HomeHero() {
  const reduceMotion = useReducedMotion();

  const entrance = (index: number) =>
    reduceMotion
      ? { initial: false as const, animate: {} }
      : {
          initial: { opacity: 0, y: 24, rotate: 0 },
          animate: { opacity: 1, y: LIFTS[index] ?? 0, rotate: ANGLES[index] ?? 0 },
          transition: { delay: 0.35 + index * 0.07, duration: 0.35, ease: 'easeOut' as const },
        };

  return (
    <div className="relative flex flex-col items-center">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: -12, rotate: -6 }}
        animate={{ opacity: 1, y: 0, rotate: -3.5 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative z-10 rounded-card bg-ink px-7 py-5 text-center shadow-card"
      >
        <p className="font-display text-[0.7rem] font-extrabold uppercase tracking-[0.22em] text-sun">
          Ton identité
        </p>
        <p className="mt-1 font-display text-3xl font-black text-white">Cléopâtre</p>
      </motion.div>

      <div
        className="-mt-4 flex items-start justify-center"
        role="group"
        aria-label="Exemple d’indices : couronne, serpent, désert, œil, diamant"
      >
        {CLUE_ICON_IDS.map((iconId, index) => {
          const icon = getIcon(iconId);
          if (!icon) return null;

          return (
            <motion.div
              key={iconId}
              {...entrance(index)}
              style={{ marginLeft: index === 0 ? 0 : '-0.6rem' }}
            >
              <IconTile icon={icon} selectionIndex={index + 1} size="sm" />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
