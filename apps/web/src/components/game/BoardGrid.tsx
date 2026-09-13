'use client';

import { useState } from 'react';
import { getIdentity, type IdentityId, type Slot } from '@identite-secrete/shared';
import { IdentitySheet } from './IdentitySheet';
import { Portrait } from './Portrait';

interface BoardGridProps {
  /** Les personnages du plateau : `board[0]` porte le numéro 1. */
  board: IdentityId[];
  /** Numéro à mettre en avant — le sien, ou celui qu'on est en train de voter. */
  highlight?: Slot | null;
  /** Libellé de la mise en avant, lu par les lecteurs d'écran. */
  highlightLabel?: string;
  compact?: boolean;
}

/**
 * Le plateau : les huit personnages, numérotés.
 *
 * Il y en a **toujours huit**, même à trois joueurs. Les numéros que personne ne
 * porte sont des leurres, et c'est tout l'intérêt : sans eux, à trois, il
 * suffirait d'éliminer pour gagner.
 *
 * Le plateau est public — au centre de la table, les cartes sont face visible.
 * Ce qui est secret, c'est qui porte quel numéro.
 *
 * Chaque case s'ouvre sur une fiche qui dit qui est le personnage (D-89) : on
 * ne demande plus à la tablée qui est ce nom inconnu.
 */
export function BoardGrid({
  board,
  highlight = null,
  highlightLabel = 'ton personnage',
  compact = false,
}: BoardGridProps) {
  // Le personnage montré survit à la fermeture : la fiche redescend pleine.
  const [shown, setShown] = useState<{ identityId: IdentityId; slot: Slot } | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="plateau-titre">
      <h2
        id="plateau-titre"
        className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
      >
        Les {board.length} personnages
      </h2>
      <p className="mb-2 text-xs text-muted">Touche un personnage pour savoir qui c&apos;est</p>

      <ul className="grid grid-cols-2 gap-2">
        {board.map((identityId, index) => {
          const slot = index + 1;
          const isHighlighted = highlight === slot;
          const name = getIdentity(identityId)?.name ?? identityId;

          return (
            <li key={`${slot}-${identityId}`}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setShown({ identityId, slot });
                  setOpen(true);
                }}
                className={[
                  // Pastille, portrait, nom : ~150 px de large sur un téléphone
                  // de 390 px. Écarts serrés pour laisser au nom de quoi tenir
                  // sur deux lignes.
                  'flex h-full w-full items-center gap-1.5 rounded-tile bg-white px-2 text-left shadow-tile',
                  'active:translate-y-0.5 active:shadow-tile-active',
                  compact ? 'py-2' : 'py-3',
                  // Deux signaux pour la mise en avant, jamais la couleur seule
                  // (§7.4) : l'anneau *et* la pastille numérotée qui change.
                  isHighlighted ? 'ring-4 ring-violet' : 'ring-1 ring-ink/5',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    'font-display text-sm font-extrabold tabular-nums',
                    isHighlighted ? 'bg-violet text-white' : 'bg-violet-light text-violet-dark',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  {slot}
                </span>

                <Portrait identityId={identityId} name={name} size="sm" />

                <span
                  className={[
                    // Un nom d'un seul long mot ne doit pas déborder de la tuile :
                    // on coupe, avec un trait d'union quand le navigateur sait le
                    // placer (la page est déclarée en français).
                    'min-w-0 flex-1 hyphens-auto break-words font-display font-extrabold leading-tight',
                    compact ? 'text-sm' : 'text-base',
                  ].join(' ')}
                >
                  <span className="sr-only">Numéro {slot} : </span>
                  {name}
                  {isHighlighted ? <span className="sr-only"> — {highlightLabel}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <IdentitySheet
        open={open}
        identityId={shown?.identityId ?? null}
        slot={shown?.slot ?? null}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
