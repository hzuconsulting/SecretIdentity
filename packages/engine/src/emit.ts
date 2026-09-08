import { SERVER_EVENTS, type Game, type ToastPayload } from '@identite-secrete/shared';
import { buildConnectedViews, buildPlayerView } from './serialization/playerView';
import type { Emitter } from './transport';

/**
 * Diffusion.
 *
 * Il n'existe **aucun** `broadcast(state)` dans ce projet : chaque joueur
 * reçoit une vue calculée pour lui. C'est plus verbeux qu'une diffusion unique,
 * et c'est exactement le point — envoyer le même état à tout le monde serait la
 * fuite d'identité que le §6 interdit.
 *
 * Cela compte doublement en pair à pair : l'hôte est un joueur comme les autres,
 * et rien ne doit transiter par son canal qu'il n'ait le droit de voir.
 */

/** Envoie à chaque joueur connecté **sa** vue de la partie. */
export function broadcastState(emitter: Emitter, game: Game, now = Date.now()): void {
  for (const { connectionId, view } of buildConnectedViews(game, now)) {
    emitter.emit(connectionId, SERVER_EVENTS.stateUpdate, view);
  }
}

/** Envoie sa vue à un seul joueur (après création, jointure ou reconnexion). */
export function sendStateTo(
  emitter: Emitter,
  game: Game,
  playerId: string,
  connectionId: string,
  now = Date.now(),
): void {
  const view = buildPlayerView(game, playerId, now);
  if (view) emitter.emit(connectionId, SERVER_EVENTS.stateUpdate, view);
}

/** Message court et non bloquant, affiché en surimpression côté client. */
export function toastAll(
  emitter: Emitter,
  game: Game,
  message: string,
  tone: ToastPayload['tone'] = 'info',
): void {
  for (const player of game.players.values()) {
    if (!player.connected || !player.connectionId) continue;
    emitter.emit(player.connectionId, SERVER_EVENTS.toast, { message, tone });
  }
}
