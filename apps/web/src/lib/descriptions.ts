import { createLazyStore } from './lazyStore';

/**
 * Une ligne pour savoir qui est le personnage (D-89).
 *
 * Un portrait ne suffit pas toujours — et un personnage sur cinq n'en a pas :
 * sans cette ligne, qui ne connaît pas un nom doit demander à la tablée, et
 * trahit parfois sa propre carte en le faisant. Chaque personnage du catalogue
 * a donc une description très courte, écrite à la main :
 * `src/data/descriptions.json`, `{ <identityId>: "<description>" }`.
 *
 * Le fichier n'est pas importé statiquement : il pèse plusieurs dizaines de
 * kilo-octets, que les pages portent déjà en catalogue. Un `import()` en fait
 * un morceau à part, nommé par son empreinte — le service worker le garde
 * comme n'importe quel script versionné, et la fiche marche hors ligne.
 *
 * Une description n'est jamais nécessaire pour jouer : si le morceau ne vient
 * pas, l'écran montre le nom et la photo, sans rien de plus.
 */

export type DescriptionMap = ReadonlyMap<string, string>;

/** Garde les seules paires texte → texte : le reste n'a rien à faire à l'écran. */
export function toDescriptionMap(raw: unknown): Map<string, string> {
  const descriptions = new Map<string, string>();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return descriptions;

  for (const [identityId, text] of Object.entries(raw)) {
    if (typeof text === 'string' && text.trim() !== '') descriptions.set(identityId, text.trim());
  }
  return descriptions;
}

async function importDescriptions(): Promise<DescriptionMap> {
  try {
    const file = await import('../data/descriptions.json');
    return toDescriptionMap(file.default);
  } catch (cause) {
    // Une description n'est qu'un plus : on le dit à qui ouvre la console, pas au joueur.
    console.debug('[descriptions] indisponibles, nom et photo seulement', cause);
    return new Map();
  }
}

const store = createLazyStore(importDescriptions);

/** Toutes les descriptions, chargées une seule fois par page. Ne rejette jamais. */
export function loadDescriptions(): Promise<DescriptionMap> {
  return store.load();
}

/** Oublie les descriptions chargées. Réservé aux tests. */
export function resetDescriptionsCache(): void {
  store.reset();
}

/** La description d'un personnage, ou `null` tant qu'elle n'est pas arrivée (ou s'il n'en a pas). */
export function useDescription(identityId: string | null | undefined): string | null {
  const descriptions = store.useValue();
  if (!identityId) return null;
  return descriptions?.get(identityId) ?? null;
}
