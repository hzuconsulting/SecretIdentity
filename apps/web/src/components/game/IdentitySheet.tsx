'use client';

import { getIdentity, type IdentityId, type Slot } from '@identite-secrete/shared';
import { useDescription } from '@/lib/descriptions';
import { Portrait } from './Portrait';
import { Sheet } from './Sheet';

interface IdentitySheetProps {
  open: boolean;
  /**
   * Le personnage montré. Il reste renseigné après la fermeture : la fiche
   * redescend avec son contenu, au lieu de se vider en pleine animation.
   */
  identityId: IdentityId | null;
  /** Son numéro sur le plateau. */
  slot: Slot | null;
  onClose: () => void;
}

/**
 * La fiche d'un personnage du plateau : sa photo en grand, son nom, et une
 * ligne pour savoir qui c'est (D-89) — sans avoir à demander à la tablée.
 *
 * Elle s'ouvre pareil pour chaque case, la sienne comprise : rien, dans son
 * ouverture, ne dit quel numéro on porte.
 */
export function IdentitySheet({ open, identityId, slot, onClose }: IdentitySheetProps) {
  const name = identityId ? (getIdentity(identityId)?.name ?? identityId) : '';
  const description = useDescription(identityId);

  return (
    <Sheet open={open && identityId !== null} onClose={onClose} title={name}>
      {identityId ? (
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <Portrait
            identityId={identityId}
            name={name}
            size="lg"
            className="shadow-tile ring-4 ring-white"
          />
          {slot !== null ? (
            <p className="font-display text-sm font-extrabold uppercase tracking-widest text-violet-dark">
              Numéro {slot}
            </p>
          ) : null}
          {description ? (
            <p className="text-lg font-semibold leading-snug text-ink">{description}</p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
