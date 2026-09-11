'use client';

import { getIdentity, type IdentityId, type Slot } from '@identite-secrete/shared';

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
 */
export function BoardGrid({
  board,
  highlight = null,
  highlightLabel = 'ton personnage',
  compact = false,
}: BoardGridProps) {
  return (
    <section aria-labelledby="plateau-titre">
      <h2
        id="plateau-titre"
        className="mb-2 font-display text-xs font-extrabold uppercase tracking-widest text-muted"
      >
        Les {board.length} personnages
      </h2>

      <ul className="grid grid-cols-2 gap-2">
        {board.map((identityId, index) => {
          const slot = index + 1;
          const isHighlighted = highlight === slot;
          const name = getIdentity(identityId)?.name ?? identityId;

          return (
            <li key={`${slot}-${identityId}`}>
              <div
                className={[
                  'flex items-center gap-2 rounded-tile bg-white px-2.5 shadow-tile',
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

                <span
                  className={[
                    'min-w-0 flex-1 font-display font-extrabold leading-tight',
                    compact ? 'text-sm' : 'text-base',
                  ].join(' ')}
                >
                  <span className="sr-only">Numéro {slot} : </span>
                  {name}
                  {isHighlighted ? <span className="sr-only"> — {highlightLabel}</span> : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
