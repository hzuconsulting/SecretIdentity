import { BASE_PACK_ID, getIdentityPool } from './data/identities';
import { shuffle, type Rng } from './rng';
import type { DifficultySetting, Identity, IdentityId } from './types';

/**
 * Attribution des identités d'une manche.
 *
 * Garanties :
 *  - les identités d'une même manche sont **distinctes** ;
 *  - une identité déjà sortie dans la partie n'est **pas réutilisée**…
 *  - …sauf si le pool est épuisé : dans ce cas on le réinitialise de façon
 *    contrôlée (§9, « Manches > identités disponibles ») et on le signale.
 */

export interface DrawIdentitiesOptions {
  count: number;
  difficulty: DifficultySetting;
  usedIdentityIds: ReadonlySet<IdentityId>;
  packIds?: string[];
}

export interface DrawIdentitiesResult {
  identities: Identity[];
  /** `true` si le pool a dû être réinitialisé pour satisfaire la demande. */
  poolReset: boolean;
}

export function filterByDifficulty(
  identities: readonly Identity[],
  difficulty: DifficultySetting,
): Identity[] {
  if (difficulty === 'mixed') return identities.slice();
  return identities.filter((identity) => identity.difficulty === difficulty);
}

export function drawIdentities(
  options: DrawIdentitiesOptions,
  rng: Rng,
): DrawIdentitiesResult {
  const { count, difficulty, usedIdentityIds } = options;
  const packIds = options.packIds ?? [BASE_PACK_ID];

  const pool = filterByDifficulty(getIdentityPool(packIds), difficulty);

  if (pool.length < count) {
    throw new Error(
      `drawIdentities: pool insuffisant (${pool.length} identités pour ${count} joueurs)`,
    );
  }

  const fresh = pool.filter((identity) => !usedIdentityIds.has(identity.id));

  if (fresh.length >= count) {
    return { identities: shuffle(rng, fresh).slice(0, count), poolReset: false };
  }

  // Pool épuisé : on repart du catalogue complet.
  return { identities: shuffle(rng, pool).slice(0, count), poolReset: true };
}
