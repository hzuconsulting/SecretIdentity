import type { Game, PlayerId } from '@identite-secrete/shared';
import type { GameStore } from './GameStore';

/**
 * Stockage en mémoire, processus unique.
 *
 * L'état de jeu est **autoritaire** ici : les objets retournés sont les objets
 * réels, pas des copies. `save()` est donc un no-op — il reste appelé partout
 * pour qu'un passage à Redis n'oblige pas à rouvrir chaque gestionnaire.
 */
export class InMemoryStore implements GameStore {
  private readonly games = new Map<string, Game>();
  /** sessionToken → { code, playerId } — index de reconnexion. */
  private readonly sessions = new Map<string, { code: string; playerId: PlayerId }>();
  /** empreinte → { code, playerId } — index de reconnexion après reprise. */
  private readonly commitments = new Map<string, { code: string; playerId: PlayerId }>();

  async create(game: Game): Promise<void> {
    this.games.set(game.code, game);
    this.indexSessions(game);
  }

  async get(code: string): Promise<Game | undefined> {
    return this.games.get(code);
  }

  async save(game: Game): Promise<void> {
    // L'objet est déjà partagé par référence ; on réindexe les sessions
    // au cas où un joueur vient d'être ajouté.
    this.games.set(game.code, game);
    this.indexSessions(game);
  }

  async delete(code: string): Promise<void> {
    const game = this.games.get(code);
    if (!game) return;
    for (const player of game.players.values()) {
      this.sessions.delete(player.sessionToken);
      if (player.sessionTokenHash) this.commitments.delete(player.sessionTokenHash);
    }
    this.games.delete(code);
  }

  async has(code: string): Promise<boolean> {
    return this.games.has(code);
  }

  async usedCodes(): Promise<ReadonlySet<string>> {
    return new Set(this.games.keys());
  }

  async findBySessionToken(
    sessionToken: string,
  ): Promise<{ game: Game; playerId: PlayerId } | undefined> {
    const found = this.lookup(this.sessions, sessionToken);

    // Le joueur existe encore, mais ce jeton est-il toujours le sien ? Une
    // reprise de place par pseudo lui en donne un neuf : l'ancien — resté sur un
    // téléphone perdu ou prêté — ne doit plus rien ouvrir.
    if (found && found.game.players.get(found.playerId)?.sessionToken !== sessionToken) {
      this.sessions.delete(sessionToken);
      return undefined;
    }

    return found;
  }

  async findBySessionCommitment(
    sessionHash: string,
  ): Promise<{ game: Game; playerId: PlayerId } | undefined> {
    return this.lookup(this.commitments, sessionHash);
  }

  private lookup(
    index: Map<string, { code: string; playerId: PlayerId }>,
    key: string,
  ): { game: Game; playerId: PlayerId } | undefined {
    const entry = index.get(key);
    if (!entry) return undefined;

    const game = this.games.get(entry.code);
    if (!game || !game.players.has(entry.playerId)) {
      index.delete(key);
      return undefined;
    }

    return { game, playerId: entry.playerId };
  }

  async purgeInactive(ttlMs: number, now: number): Promise<string[]> {
    const purged: string[] = [];
    for (const [code, game] of this.games) {
      if (now - game.lastActivityAt > ttlMs) {
        purged.push(code);
      }
    }
    for (const code of purged) {
      await this.delete(code);
    }
    return purged;
  }

  async count(): Promise<number> {
    return this.games.size;
  }

  private indexSessions(game: Game): void {
    for (const player of game.players.values()) {
      const entry = { code: game.code, playerId: player.id };
      this.sessions.set(player.sessionToken, entry);

      // L'empreinte disparaît dès que le joueur a présenté son vrai jeton : on
      // retire alors l'entrée, sinon elle resterait une seconde porte ouverte
      // sur la même session pour toute la durée de la partie.
      if (player.sessionTokenHash) this.commitments.set(player.sessionTokenHash, entry);
      else this.removeCommitmentOf(player.id, game.code);
    }
  }

  private removeCommitmentOf(playerId: PlayerId, code: string): void {
    for (const [hash, entry] of this.commitments) {
      if (entry.playerId === playerId && entry.code === code) this.commitments.delete(hash);
    }
  }
}
