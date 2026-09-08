import type { Socket } from 'socket.io';
import { createHandlerContext, type HandlerDeps } from './context';
import { registerSessionHandlers } from './session';
import { registerRoundHandlers } from './round';

export { defaultHandlerConfig, type HandlerDeps } from './context';

/**
 * Branche tous les gestionnaires d'une socket.
 *
 * Le découpage suit les domaines du cahier des charges : la session (§4.3,
 * entrées et sorties) et le déroulé d'une partie (§4.1 et §4.3, actions de
 * jeu). Les deux modules partagent le contexte construit ici, jamais leur
 * état interne.
 */
export function registerGameHandlers(socket: Socket, deps: HandlerDeps): void {
  const ctx = createHandlerContext(socket, deps);

  registerSessionHandlers(ctx);
  registerRoundHandlers(ctx);
}
