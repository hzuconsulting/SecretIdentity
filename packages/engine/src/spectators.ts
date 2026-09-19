import { MAX_SPECTATORS } from '@identite-secrete/shared';
import type { ConnectionId } from './transport';

/**
 * Les écrans branchés sur une partie sans y jouer.
 *
 * Ils vivent **ici et pas dans `Game`**, et c'est le point important : un
 * spectateur n'est pas un état de la partie. Il ne compte pas dans
 * `MAX_PLAYERS`, ne reçoit pas de carte Mystère, ne bloque aucune phase,
 * n'apparaît dans aucun classement, n'est pas sauvegardé au rechargement de
 * l'hôte et ne part pas dans l'instantané de reprise. Le mettre dans la partie
 * aurait demandé de l'écarter explicitement en une douzaine d'endroits, et un
 * oubli se serait payé en boîtier fantôme à deviner.
 *
 * Ce registre vit donc aussi longtemps que le nœud, pas que la partie : il est
 * indexé par connexion, la seule chose qu'un spectateur possède.
 */
interface Watch {
  code: string;
  /**
   * Empreinte de la dernière vue envoyée sur ce canal.
   *
   * Par **connexion** et non par partie : deux écrans branchés à des moments
   * différents n'en sont pas au même point, et une mémoire commune priverait
   * le second de sa première vue.
   */
  lastSent: string | null;
}

export class SpectatorRegistry {
  private readonly byConnection = new Map<ConnectionId, Watch>();

  /** Nombre d'écrans branchés, toutes parties confondues. */
  get size(): number {
    return this.byConnection.size;
  }

  has(connectionId: ConnectionId): boolean {
    return this.byConnection.has(connectionId);
  }

  /**
   * Branche une connexion. Rejouable : un écran renvoie sa demande à chaque
   * réouverture de canal, et retrouve alors sa place sans rien perdre.
   */
  add(connectionId: ConnectionId, code: string): void {
    const target = code.toUpperCase();
    const existing = this.byConnection.get(connectionId);
    this.byConnection.set(connectionId, {
      code: target,
      lastSent: existing?.code === target ? existing.lastSent : null,
    });
  }

  /** Débranche une connexion. Idempotent : appelé sur toute fermeture de canal. */
  remove(connectionId: ConnectionId): void {
    this.byConnection.delete(connectionId);
  }

  /** L'empreinte de la dernière vue envoyée, ou `null` si on n'a rien envoyé. */
  lastSent(connectionId: ConnectionId): string | null {
    return this.byConnection.get(connectionId)?.lastSent ?? null;
  }

  markSent(connectionId: ConnectionId, fingerprint: string): void {
    const watch = this.byConnection.get(connectionId);
    if (watch) watch.lastSent = fingerprint;
  }

  count(code: string): number {
    const target = code.toUpperCase();
    let total = 0;
    for (const watch of this.byConnection.values()) {
      if (watch.code === target) total++;
    }
    return total;
  }

  /** `true` si une partie a atteint son plafond d'écrans. */
  isFull(code: string): boolean {
    return this.count(code) >= MAX_SPECTATORS;
  }

  connectionsFor(code: string): ConnectionId[] {
    const target = code.toUpperCase();
    const connections: ConnectionId[] = [];
    for (const [connectionId, watch] of this.byConnection) {
      if (watch.code === target) connections.push(connectionId);
    }
    return connections;
  }

  /** Les parties effectivement regardées, sans doublon. */
  codes(): string[] {
    return [...new Set([...this.byConnection.values()].map((watch) => watch.code))];
  }

  clear(): void {
    this.byConnection.clear();
  }
}
