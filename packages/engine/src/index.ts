/**
 * Moteur de jeu — indépendant du transport et de l'environnement.
 *
 * Ce paquet contient tout ce qui décide : règles, machine à états, calcul des
 * vues joueur. Il ne contient rien qui ouvre une socket, lise une variable
 * d'environnement ou touche au DOM, et c'est ce qui lui permet de tourner à
 * l'identique dans le navigateur de l'hôte et dans les tests.
 */

export { GameHost, type EmitListener, type GameHostOptions } from './host';
export { GameEngine, type EngineDeps } from './game/engine';
export { TimerRegistry, timerKeys } from './timers';
export { InMemoryStore } from './store/InMemoryStore';
export type { GameStore } from './store/GameStore';
export { RateLimiter } from './rateLimit';
export { logger, setLogLevel, type LogLevel } from './logger';
export { createSessionToken, createId } from './random';
export {
  serializeGame,
  deserializeGame,
  type SerializedGame,
} from './persistence';
export type { ConnectionId, Emitter } from './transport';

