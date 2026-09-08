import { SERVER_EVENTS, type Game, type ToastPayload } from '@identite-secrete/shared';
import type { Server } from 'socket.io';
import { buildConnectedViews, buildPlayerView } from '../serialization/playerView';

/**
 * Diffusion.
 *
 * Il n'existe **aucun** `io.to(room).emit(state)` dans ce projet : chaque
 * joueur reçoit une vue calculée pour lui. C'est plus verbeux qu'un broadcast,
 * et c'est exactement le point — un broadcast d'état complet serait la fuite
 * d'identité que le §6 interdit.
 */

/** Envoie à chaque joueur connecté **sa** vue de la partie. */
export function broadcastState(io: Server, game: Game, now = Date.now()): void {
  for (const { socketId, view } of buildConnectedViews(game, now)) {
    io.to(socketId).emit(SERVER_EVENTS.stateUpdate, view);
  }
}

/** Envoie sa vue à un seul joueur (après création, jointure ou reconnexion). */
export function sendStateTo(
  io: Server,
  game: Game,
  playerId: string,
  socketId: string,
  now = Date.now(),
): void {
  const view = buildPlayerView(game, playerId, now);
  if (view) io.to(socketId).emit(SERVER_EVENTS.stateUpdate, view);
}

/** Message court et non bloquant, affiché en surimpression côté client. */
export function toastAll(
  io: Server,
  game: Game,
  message: string,
  tone: ToastPayload['tone'] = 'info',
): void {
  for (const player of game.players.values()) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit(SERVER_EVENTS.toast, { message, tone });
  }
}
