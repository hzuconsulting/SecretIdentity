'use client';

import { getIcon, type PictoZone, type ShownPicto } from '@identite-secrete/shared';
import { IconTile } from '@/components/ui/IconTile';

/**
 * Le boîtier d'un joueur : ce qu'il a posé, et où.
 *
 * Les deux emplacements ne disent pas la même chose, et c'est le cœur du jeu :
 * le **vert** affirme (« mon personnage, c'est ça »), le **rouge** nie (« mon
 * personnage, ce n'est pas ça »). Un même pictogramme change complètement de
 * sens selon la zone — d'où deux signaux à l'écran, la couleur *et* le symbole,
 * jamais la couleur seule (§7.4).
 */

const ZONE_STYLE: Record<PictoZone, { ring: string; chip: string; sign: string; label: string }> = {
  green: {
    ring: 'ring-mint',
    chip: 'bg-mint-light text-mint',
    sign: '✓',
    label: 'C’est représentatif',
  },
  red: {
    ring: 'ring-pink',
    chip: 'bg-pink-light text-pink',
    sign: '✗',
    label: 'Ce n’est pas représentatif',
  },
};

export function ZoneLabel({ zone }: { zone: PictoZone }) {
  const style = ZONE_STYLE[zone];

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1',
        'font-display text-[0.65rem] font-extrabold uppercase tracking-widest',
        style.chip,
      ].join(' ')}
    >
      <span aria-hidden="true">{style.sign}</span>
      {style.label}
    </span>
  );
}

/** Un pictogramme posé, teinté par sa zone. */
export function PlacedPictoTile({
  picto,
  size = 'sm',
}: {
  picto: ShownPicto;
  size?: 'sm' | 'md';
}) {
  const icon = getIcon(picto.iconId);
  if (!icon) return null;

  const style = ZONE_STYLE[picto.zone];

  return (
    <span className="relative inline-flex">
      <IconTile icon={icon} size={size} ring={`ring-4 ${style.ring}`} />
      <span
        className={[
          'absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full',
          'font-display text-xs font-extrabold shadow-tile',
          style.chip,
        ].join(' ')}
        aria-hidden="true"
      >
        {style.sign}
      </span>
      <span className="sr-only">
        {icon.label} — {style.label}
      </span>
    </span>
  );
}

/**
 * Le boîtier complet, zone par zone.
 *
 * Les zones vides ne sont pas affichées : un boîtier tout en rouge est une
 * stratégie, pas un oubli, et lui coller une case verte vide brouillerait le
 * message.
 */
export function PictoCase({ placed }: { placed: ShownPicto[] }) {
  if (placed.length === 0) {
    return (
      <p className="rounded-tile bg-violet-light/60 px-3 py-2 text-sm font-semibold text-muted">
        Boîtier vide — ce joueur n’a rien posé.
      </p>
    );
  }

  const zones: PictoZone[] = ['green', 'red'];

  return (
    <div className="flex flex-col gap-2">
      {zones.map((zone) => {
        const inZone = placed.filter((picto) => picto.zone === zone);
        if (inZone.length === 0) return null;

        return (
          <div key={zone} className="flex flex-wrap items-center gap-2">
            <ZoneLabel zone={zone} />
            <ul className="flex flex-wrap gap-2">
              {inZone.map((picto, index) => (
                <li key={`${picto.iconId}-${index}`}>
                  <PlacedPictoTile picto={picto} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
