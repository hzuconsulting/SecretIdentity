import type { GameIcon } from '@identite-secrete/shared';

interface IconTileProps {
  icon: GameIcon;
  /** Rang de sélection (1, 2, 3…). `null` = non sélectionnée. */
  selectionIndex?: number | null;
  size?: 'sm' | 'md';
  /**
   * Remplace l'anneau par défaut — utilisé pour teinter un pictogramme selon sa
   * zone. On **substitue** au lieu d'ajouter : deux largeurs d'anneau dans la
   * même classe laisseraient l'ordre du CSS généré trancher, pas nous.
   */
  ring?: string;
  className?: string;
}

/**
 * La case garde sa taille ; c'est le pictogramme qui la remplit. À 24 px dans
 * une case de 56, il y avait plus de blanc que d'image : on vise environ 70 %
 * de la case, et `leading-none` pour qu'une grande police ne déborde pas.
 */
const SIZES = {
  sm: 'h-14 w-14',
  md: 'h-20 w-20',
} as const;

const ICON_SIZES = {
  sm: 'text-[2.375rem]',
  md: 'text-[3.375rem]',
} as const;

/**
 * Tuile d'icône.
 *
 * La sélection est portée par **deux** signaux : la bordure violette *et* la
 * pastille numérotée. Jamais la couleur seule (§7.4).
 */
export function IconTile({
  icon,
  selectionIndex = null,
  size = 'md',
  ring,
  className,
}: IconTileProps) {
  const selected = selectionIndex !== null;

  return (
    <span
      className={[
        'relative inline-flex items-center justify-center rounded-tile bg-white',
        'shadow-tile transition-transform duration-150',
        SIZES[size],
        ring ?? (selected ? 'ring-4 ring-violet' : 'ring-1 ring-ink/5'),
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={icon.label}
    >
      <span aria-hidden="true" className={`leading-none ${ICON_SIZES[size]}`}>
        {icon.icon}
      </span>

      {selected ? (
        <span
          className={
            'absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full ' +
            'bg-violet font-display text-sm font-extrabold text-white shadow-tile'
          }
          aria-hidden="true"
        >
          {selectionIndex}
        </span>
      ) : null}
    </span>
  );
}
