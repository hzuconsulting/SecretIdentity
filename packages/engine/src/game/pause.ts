import {
  MIN_PLAYERS,
  PAUSE_ABANDON_MS,
  type Game,
} from '@identite-secrete/shared';
import { logger } from '../logger';
import { broadcastState, toastAll } from '../emit';
import { connectedCount } from './lobby';
import { isPausablePhase } from './roundRules';
import type { GameEngine, EngineDeps } from './engine';

/**
 * Mise en pause d'une partie faute de joueurs (§9).
 *
 * Séparé du moteur parce que c'est une préoccupation distincte : le moteur
 * fait avancer une partie, ceci l'arrête et la redémarre. Les deux modules se
 * partagent les clés de minuteur, définies ici pour éviter qu'un `cancel`
 * oublie l'une des deux échéances.
 */

export function phaseTimerKey(code: string): string {
  return `${code}:phase`;
}

export function abandonTimerKey(code: string): string {
  return `${code}:pause-abandon`;
}

/**
 * Gèle la partie s'il ne reste pas assez de joueurs connectés.
 *
 * Le minuteur de phase est annulé : sans cela, les manches continueraient de
 * défiler dans le vide et la partie serait finie au retour des joueurs. Une
 * échéance d'abandon est armée pour ne pas laisser une partie figée
 * indéfiniment.
 */
export async function pauseIfNeeded(deps: EngineDeps, game: Game): Promise<boolean> {
  if (game.pausedAt !== null) return true;
  if (!isPausablePhase(game.phase)) return false;
  if (connectedCount(game) >= MIN_PLAYERS) return false;

  const now = Date.now();
  game.pausedAt = now;
  deps.timers.cancel(phaseTimerKey(game.code));

  await deps.store.save(game);
  logger.info(`Partie ${game.code} en pause (${connectedCount(game)} joueur(s) connecté(s))`);
  toastAll(deps.emitter, game, 'Partie en pause : il manque des joueurs.', 'warning');
  broadcastState(deps.emitter, game, now);

  deps.timers.schedule(abandonTimerKey(game.code), PAUSE_ABANDON_MS, () => {
    void abandonToLobby(deps, game.code);
  });

  return true;
}

/**
 * Reprend une partie en pause quand assez de joueurs sont revenus.
 *
 * La phase courante redémarre avec une **échéance neuve** : les joueurs
 * retrouvent leur temps, et personne n'arrive sur un décompte déjà à zéro. Les
 * effets de sortie ne sont pas rejoués — sans quoi une pause survenue en phase
 * de devinette ferait compter les points une deuxième fois.
 */
export async function resumeIfPossible(
  engine: GameEngine,
  deps: EngineDeps,
  game: Game,
): Promise<boolean> {
  if (game.pausedAt === null) return false;
  if (connectedCount(game) < MIN_PLAYERS) return false;

  const now = Date.now();
  game.pausedAt = null;
  deps.timers.cancel(abandonTimerKey(game.code));

  logger.info(`Partie ${game.code} reprend`);
  toastAll(deps.emitter, game, 'Tout le monde est là, on reprend !', 'success');

  await engine.enterPhase(game, game.phase, now, { applyExitEffects: false });
  return true;
}

/** Personne n'est revenu : on rend la main plutôt que de rester figé. */
async function abandonToLobby(deps: EngineDeps, code: string): Promise<void> {
  const game = await deps.store.get(code);
  if (!game || game.pausedAt === null) return;

  const now = Date.now();
  game.pausedAt = null;
  game.phase = 'LOBBY';
  game.rounds = [];
  game.currentRound = 0;
  for (const player of game.players.values()) player.score = 0;

  await deps.store.save(game);
  logger.info(`Partie ${code} abandonnée faute de joueurs, retour au salon`);
  toastAll(deps.emitter, game, 'Partie abandonnée : retour au salon.', 'warning');
  broadcastState(deps.emitter, game, now);
}
