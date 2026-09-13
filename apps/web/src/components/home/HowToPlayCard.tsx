import Link from 'next/link';
import { getIcon } from '@identite-secrete/shared';

/**
 * L'entrée des règles, illustrée par la mécanique du jeu elle-même : une
 * identité secrète, et la série d'icônes censée la faire deviner. Ici
 * « Cléopâtre » se lit par : couronne, serpent, désert, œil, diamant.
 *
 * Elle était le grand héros du haut de l'accueil, et repoussait sous le pli les
 * parties ouvertes — ce qu'on vient chercher en premier quand des amis jouent
 * déjà. Réduite, elle passe sous la liste et mène aux règles.
 */
const CLUE_ICON_IDS = ['crown', 'snake', 'desert', 'eye', 'gem'] as const;
const ANGLES = [-8, -4, 0, 4, 8];

export function HowToPlayCard() {
  return (
    <Link
      href="/comment-jouer"
      className={
        'flex items-center gap-3 rounded-tile bg-white/70 px-4 py-3 shadow-tile ' +
        'transition-[transform,background-color,box-shadow] duration-150 hover:bg-white ' +
        'active:translate-y-1 active:shadow-tile-active'
      }
    >
      <span className="min-w-0 flex-1">
        {/* Décor : le lien se nomme par son texte seul. */}
        <span className="flex items-center gap-2.5" aria-hidden="true">
          <span className="-rotate-3 rounded-lg bg-ink px-2.5 py-1 font-display text-sm font-black text-white">
            Cléopâtre
          </span>
          <span className="flex">
            {CLUE_ICON_IDS.map((iconId, index) => {
              const icon = getIcon(iconId);
              if (!icon) return null;

              return (
                <span
                  key={iconId}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[1.35rem] leading-none ring-2 ring-violet"
                  style={{
                    marginLeft: index === 0 ? 0 : '-0.25rem',
                    transform: `rotate(${ANGLES[index] ?? 0}deg)`,
                  }}
                >
                  {icon.icon}
                </span>
              );
            })}
          </span>
        </span>

        <span className="mt-2 block font-display text-base font-extrabold uppercase tracking-wide text-ink">
          Comment jouer&nbsp;?
        </span>
      </span>

      <span className="shrink-0 font-display text-2xl font-black text-violet" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
