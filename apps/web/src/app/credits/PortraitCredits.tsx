'use client';

import { useMemo } from 'react';
import { getIdentity } from '@identite-secrete/shared';
import { Portrait } from '@/components/game/Portrait';
import { usePortraits, type PortraitEntry, type PortraitMap } from '@/lib/portraits';

interface CreditLine {
  identityId: string;
  name: string;
  entry: PortraitEntry;
}

interface CreditGroup {
  letter: string;
  lines: CreditLine[];
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Première lettre, sans accent : « Émile » se range sous E, « Œil-de-Faucon »
 * sous O — là où le tri alphabétique le place. Le reste (chiffres…) sous #.
 */
function groupLetter(name: string): string {
  const first = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/^[Œœ]/, 'O')
    .replace(/^[Ææ]/, 'A')
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/**
 * Regroupe par initiale, dans l'ordre alphabétique français.
 *
 * Une entrée dont le personnage n'est plus au catalogue est ignorée : le
 * fichier peut avoir un temps d'avance ou de retard sur le code.
 */
function buildGroups(portraits: PortraitMap): CreditGroup[] {
  const lines: CreditLine[] = [];
  for (const [identityId, entry] of portraits) {
    const identity = getIdentity(identityId);
    if (identity) lines.push({ identityId, name: identity.name, entry });
  }
  lines.sort((a, b) => collator.compare(a.name, b.name));

  // Regroupé par clé, pas par voisinage : un nom que le tri glisserait au milieu
  // d'une autre lettre ne doit pas couper un groupe en deux.
  const byLetter = new Map<string, CreditLine[]>();
  for (const line of lines) {
    const letter = groupLetter(line.name);
    const group = byLetter.get(letter);
    if (group) group.push(line);
    else byLetter.set(letter, [line]);
  }

  return [...byLetter.entries()]
    .map(([letter, groupLines]) => ({ letter, lines: groupLines }))
    .sort((a, b) => (a.letter === '#' ? -1 : b.letter === '#' ? 1 : a.letter.localeCompare(b.letter)));
}

const linkClass =
  'font-semibold text-violet underline decoration-violet/30 underline-offset-2';

/**
 * La liste des photos : personnage, vignette, auteur, licence, page Commons.
 *
 * Lue depuis `portraits.json`, comme en partie — la même requête, gardée en
 * mémoire. Les vignettes ne se chargent qu'à l'approche de l'écran : la liste
 * compte des centaines d'entrées.
 */
export function PortraitCredits() {
  const portraits = usePortraits();
  const groups = useMemo(() => (portraits ? buildGroups(portraits) : null), [portraits]);

  if (groups === null) {
    return (
      <p className="text-center text-sm font-semibold text-muted" role="status">
        Chargement des crédits…
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-tile bg-white px-4 py-3 text-sm font-semibold text-muted shadow-tile">
        La liste des photos n’est pas disponible pour l’instant — hors ligne, peut-être.
        Réessaie plus tard.
      </p>
    );
  }

  const count = groups.reduce((total, group) => total + group.lines.length, 0);

  return (
    <section aria-labelledby="credits-liste" className="flex flex-col gap-4">
      <h2
        id="credits-liste"
        className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
      >
        {count} photo{count > 1 ? 's' : ''}
      </h2>

      {groups.map((group) => (
        <section key={group.letter} aria-label={`Lettre ${group.letter}`}>
          <h3
            className="mb-1 font-display text-lg font-black text-violet-dark"
            aria-hidden="true"
          >
            {group.letter}
          </h3>
          <ul className="divide-y divide-ink/5 rounded-card bg-white px-4 shadow-card">
            {group.lines.map(({ identityId, name, entry }) => (
              <li key={identityId} className="flex gap-3 py-3">
                <Portrait identityId={identityId} name={name} size="md" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="break-words font-display text-base font-extrabold leading-tight">
                    {name}
                  </p>
                  <p className="mt-0.5 break-words text-muted">
                    {entry.a} ·{' '}
                    {entry.u ? (
                      <a
                        href={entry.u}
                        target="_blank"
                        rel="noopener noreferrer license"
                        className={linkClass}
                      >
                        {entry.l}
                      </a>
                    ) : (
                      entry.l
                    )}
                  </p>
                  <a
                    href={entry.p}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={['mt-0.5 inline-block', linkClass].join(' ')}
                  >
                    Fichier sur Commons<span aria-hidden="true"> ↗</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
