'use client';

import { parseRelayHandoff, type RelayHandoffPayload } from '@identite-secrete/shared';

/**
 * L'instantané de reprise, en attente dans le stockage de chaque invité.
 *
 * ─── Pourquoi une clé à part ───
 *
 * La tentation est d'écrire sous `identite-secrete:hosted:<CODE>`, la clé de
 * l'hôte. Ce serait un bug sérieux : `net/index.ts` s'en sert pour décider qui
 * héberge au chargement de la page. Un invité qui rafraîchit son onglet
 * **volerait** alors l'identifiant de signalisation à un hôte parfaitement
 * vivant, et couperait la partie en deux.
 *
 * La clé est donc distincte, et elle n'est jamais lue par ce chemin. Elle n'est
 * promue vers celle de l'hôte qu'après une décision explicite de reprise, et
 * seulement une fois l'identifiant réservé.
 *
 * ─── Pourquoi deux péremptions ───
 *
 * Six heures, comme la sauvegarde de l'hôte, parce que c'est la durée de vie
 * raisonnable d'une soirée. Mais surtout **dix minutes** sur la réception : un
 * instantané plus vieux que ça décrit une partie qui a continué sans nous —
 * l'hôte allait bien, c'est notre canal qui était coupé. Le ressusciter
 * ramènerait tout le monde en arrière. Mieux vaut dire que la partie est finie.
 */

const PREFIX = 'identite-secrete:relay:';

/** Au-delà, l'instantané est trop vieux pour décrire la partie en cours. */
const RELAY_TTL_MS = 10 * 60 * 1_000;

export interface StoredRelay {
  payload: RelayHandoffPayload;
  /** Horloge **locale** à la réception. Les horloges des pairs divergent. */
  receivedAt: number;
}

function key(code: string): string {
  return `${PREFIX}${code.toUpperCase()}`;
}

/**
 * Départage l'instantané reçu et celui déjà en réserve.
 *
 * Extrait pour être testable sans `localStorage` : c'est la seule vraie logique
 * de ce module, tout le reste est de la plomberie autour du stockage.
 *
 * L'ordre des critères compte. La **génération** prime, parce qu'elle survit à
 * une reprise : un instantané de la génération 2 décrit forcément une partie
 * plus avancée qu'un de la génération 1, quels que soient leurs compteurs. Le
 * compteur ne départage qu'à génération égale, c'est-à-dire au sein d'un même
 * hôte, où il est monotone. Les horloges, elles, n'entrent jamais en jeu.
 */
export function pickBestRelay(
  stored: StoredRelay | null,
  incoming: StoredRelay,
): StoredRelay {
  if (!stored) return incoming;

  const a = stored.payload.snapshot;
  const b = incoming.payload.snapshot;

  if (b.epoch !== a.epoch) return b.epoch > a.epoch ? incoming : stored;
  return b.seq >= a.seq ? incoming : stored;
}

/** `true` si l'instantané est trop vieux pour qu'on tente encore une reprise. */
export function isStale(entry: StoredRelay, now = Date.now()): boolean {
  return now - entry.receivedAt > RELAY_TTL_MS;
}

/**
 * Enregistre un instantané reçu, après validation complète.
 *
 * La validation a lieu **ici**, avant l'écriture, et elle aura lieu une seconde
 * fois à l'adoption : entre les deux, le contenu transite par un stockage que
 * l'utilisateur peut éditer, et l'adoptant devient autoritaire pour tout le
 * monde. Deux contrôles pour deux frontières différentes.
 */
export function saveRelay(code: string, raw: unknown, now = Date.now()): StoredRelay | null {
  const payload = parseRelayHandoff(raw);
  if (!payload) return null;
  // Un instantané qui parle d'une autre partie n'a rien à faire sous ce code.
  if (payload.snapshot.code !== code.toUpperCase()) return null;

  const best = pickBestRelay(loadRelay(code, now), { payload, receivedAt: now });

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key(code), JSON.stringify(best));
    } catch {
      // Stockage plein ou refusé. On perd la possibilité de reprendre la
      // partie, pas la partie elle-même : rien d'autre à faire.
    }
  }

  return best;
}

/** L'instantané en réserve pour ce code, s'il est encore exploitable. */
export function loadRelay(code: string, now = Date.now()): StoredRelay | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(key(code));
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      clearRelay(code);
      return null;
    }

    const { payload, receivedAt } = parsed as Partial<StoredRelay>;
    const validated = parseRelayHandoff(payload);
    if (!validated || typeof receivedAt !== 'number') {
      clearRelay(code);
      return null;
    }

    const entry: StoredRelay = { payload: validated, receivedAt };
    if (isStale(entry, now)) {
      clearRelay(code);
      return null;
    }

    return entry;
  } catch {
    clearRelay(code);
    return null;
  }
}

export function clearRelay(code: string): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(key(code));
  } catch {
    // Au pire l'entrée périmera d'elle-même.
  }
}
