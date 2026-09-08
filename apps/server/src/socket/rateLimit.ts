import { RATE_LIMIT_MAX_EVENTS, RATE_LIMIT_WINDOW_MS } from '@identite-secrete/shared';

/**
 * Limitation de débit, par socket.
 *
 * Rien dans le jeu ne dépend de la vitesse d'envoi : chaque action est validée
 * et idempotente, donc une boucle automatisée ne peut pas fausser une partie.
 * Ce qu'elle peut faire, c'est saturer le processus — le serveur est unique et
 * garde tout en mémoire. Le plafond est donc volontairement haut : il ne vise
 * que les boucles, jamais un joueur qui tapote ses icônes.
 *
 * Fenêtre glissante simple : on garde les horodatages de la fenêtre courante.
 * Suffisant pour quelques dizaines de sockets ; à revoir si le serveur devait
 * en accueillir des milliers.
 */
export class RateLimiter {
  private readonly hits: number[] = [];

  constructor(
    private readonly maxEvents = RATE_LIMIT_MAX_EVENTS,
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
  ) {}

  /** `true` si l'événement est accepté, `false` s'il dépasse le plafond. */
  accept(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;

    while (this.hits.length > 0 && (this.hits[0] as number) <= cutoff) {
      this.hits.shift();
    }

    if (this.hits.length >= this.maxEvents) return false;

    this.hits.push(now);
    return true;
  }
}
