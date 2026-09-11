import type { Game, PlayerId } from '@identite-secrete/shared';

/**
 * Abstraction de persistance.
 *
 * Les parties sont éphémères : `InMemoryStore` suffit et évite toute latence
 * base de données dans la boucle de jeu. `RedisStore` est prévue (plusieurs
 * process serveur) mais **non implémentée** — l'interface existe pour que ce
 * soit un ajout, pas une réécriture.
 *
 * Les méthodes sont asynchrones exprès : une implémentation Redis ne pourra
 * pas être synchrone, et on ne veut pas avoir à changer tous les appelants.
 */
export interface GameStore {
  create(game: Game): Promise<void>;
  get(code: string): Promise<Game | undefined>;
  /** Persiste un jeu modifié. Sans effet en mémoire, indispensable en Redis. */
  save(game: Game): Promise<void>;
  delete(code: string): Promise<void>;
  has(code: string): Promise<boolean>;

  /** Codes actuellement utilisés — pour garantir l'unicité à la création. */
  usedCodes(): Promise<ReadonlySet<string>>;

  /** Retrouve une partie à partir d'un jeton de session (reconnexion). */
  findBySessionToken(
    sessionToken: string,
  ): Promise<{ game: Game; playerId: PlayerId } | undefined>;

  /**
   * Retrouve une partie à partir de l'**empreinte** d'un jeton.
   *
   * Sert après une reprise d'hébergement : le nouvel hôte n'a jamais reçu les
   * jetons, seulement leurs empreintes. Le joueur présente le sien, on en
   * calcule l'empreinte, et c'est elle qu'on cherche ici.
   */
  findBySessionCommitment(
    sessionHash: string,
  ): Promise<{ game: Game; playerId: PlayerId } | undefined>;

  /** Supprime les parties inactives depuis plus de `ttlMs`. Retourne les codes purgés. */
  purgeInactive(ttlMs: number, now: number): Promise<string[]>;

  /** Nombre de parties en cours — exposé par le point de santé. */
  count(): Promise<number>;
}
