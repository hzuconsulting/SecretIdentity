import type { EventHandler } from './context';
import { sessionHandlers } from './session';
import { roundHandlers } from './round';

export {
  ConnectionState,
  createHandlerContext,
  defaultHandlerConfig,
  type Binding,
  type EventHandler,
  type HandlerContext,
  type HandlerDeps,
} from './context';
export { armAbsenceTimers, handleDisconnect } from './session';

/**
 * Table complète des événements acceptés.
 *
 * Le découpage suit les domaines du cahier des charges : la session (§4.3,
 * entrées et sorties) et le déroulé d'une partie (§4.1 et §4.3, actions de
 * jeu). Un événement absent de cette table est rejeté par le `GameHost` — il
 * n'existe aucun chemin générique qui laisserait passer un nom inattendu.
 */
export const eventHandlers: Record<string, EventHandler> = {
  ...sessionHandlers,
  ...roundHandlers,
};
