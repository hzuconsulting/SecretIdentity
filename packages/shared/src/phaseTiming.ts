import type { TimerSeconds, TimerSetting } from './types';

/**
 * Durée des phases de jeu en mode « Auto ».
 *
 * Le temps utile ne dépend pas de la même façon du nombre de joueurs selon la
 * phase :
 *
 * - **Poser ses pictos**, c'est réfléchir à *son* personnage contre les sept
 *   autres du plateau. Le nombre d'adversaires change peu le travail, mais une
 *   table nombreuse est plus bruyante et plus lente à se concentrer : on accorde
 *   un peu plus, sans excès.
 * - **Voter**, c'est lire *chaque* boîtier adverse et attribuer un numéro à
 *   chacun. Le travail croît avec le nombre d'adversaires, et la durée aussi.
 *
 * Les valeurs sont arrondies à 5 s pour s'afficher proprement.
 *
 * | Joueurs | Poser  | Voter       |
 * |---------|--------|-------------|
 * | 2       | 1 min 30 | 1 min 05  |
 * | 3       | 1 min 30 | 1 min 30  |
 * | 4       | 1 min 40 | 1 min 55  |
 * | 5       | 1 min 50 | 2 min 20  |
 * | 6       | 2 min    | 2 min 45  |
 * | 8       | 2 min 20 | 3 min 35  |
 */

/**
 * Table en dessous de laquelle « Poser » ne raccourcit plus : choisir ses
 * pictos contre les sept autres personnages prend le même temps à deux qu'à
 * trois.
 */
const CLUE_BASE_PLAYERS = 3;

export function autoClueSeconds(playerCount: number): number {
  const players = Math.max(CLUE_BASE_PLAYERS, playerCount);
  return roundTo5(90 + 10 * (players - CLUE_BASE_PLAYERS));
}

export function autoGuessSeconds(playerCount: number): number {
  const opponents = Math.max(1, playerCount - 1);
  return roundTo5(40 + 25 * opponents);
}

/**
 * Durée effective d'une phase, en secondes. `null` = sans limite.
 *
 * `playerCount` est le nombre de participants **de la manche** — pas celui du
 * salon au moment du réglage : la durée est calculée à l'entrée de la phase.
 */
export function resolveTimer(
  setting: TimerSetting,
  kind: 'clue' | 'guess',
  playerCount: number,
): TimerSeconds {
  if (setting === 'auto') {
    return kind === 'clue' ? autoClueSeconds(playerCount) : autoGuessSeconds(playerCount);
  }
  return setting;
}

function roundTo5(seconds: number): number {
  return Math.round(seconds / 5) * 5;
}
