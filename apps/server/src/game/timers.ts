/**
 * Registre de minuteurs serveur.
 *
 * Toute échéance du jeu (période de grâce, transfert d'hôte, et plus tard fin
 * de phase) passe par ici, sous une clé nommée. Deux raisons : on peut annuler
 * proprement quand la condition disparaît (le joueur revient), et on peut tout
 * nettoyer d'un coup quand une partie est purgée — sinon un `setTimeout`
 * orphelin garde une référence sur un objet `Game` mort.
 */
export class TimerRegistry {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /** Programme (ou reprogramme) une échéance. */
  schedule(key: string, delayMs: number, callback: () => void): void {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, delayMs);
    // Ne pas empêcher le process de s'arrêter.
    timer.unref?.();
    this.timers.set(key, timer);
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(key);
  }

  /** Annule toutes les échéances dont la clé commence par `prefix`. */
  cancelByPrefix(prefix: string): void {
    for (const key of [...this.timers.keys()]) {
      if (key.startsWith(prefix)) this.cancel(key);
    }
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }

  clearAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

/**
 * Les clés commencent toutes par le code de la partie : `cancelByPrefix` peut
 * donc nettoyer une partie entière en une ligne.
 */
export const timerKeys = {
  /** Retrait d'un joueur après la période de grâce. */
  drop: (code: string, playerId: string) => `${code}:drop:${playerId}`,
  /** Transfert du rôle d'hôte après déconnexion. */
  hostTransfer: (code: string) => `${code}:host`,
  /** Préfixe de toutes les échéances d'une partie. */
  gamePrefix: (code: string) => `${code}:`,
} as const;
