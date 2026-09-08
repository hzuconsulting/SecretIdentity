import { AVATAR_COLORS } from './constants';
import type { DifficultySetting, TimerSeconds } from './types';

/** `62` → `"01:02"`. Toujours deux chiffres, jamais de valeur négative. */
export function formatCountdown(secondsRemaining: number): string {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Secondes restantes avant `phaseEndsAt`, horloge serveur corrigée. */
export function secondsRemaining(
  phaseEndsAt: number | null,
  now: number,
): number | null {
  if (phaseEndsAt === null) return null;
  return Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
}

export function formatTimerOption(value: TimerSeconds): string {
  return value === null ? 'Sans limite' : `${value} s`;
}

const DIFFICULTY_LABELS: Record<DifficultySetting, string> = {
  easy: 'Facile',
  medium: 'Normal',
  hard: 'Difficile',
  mixed: 'Mélangé',
};

export function formatDifficulty(value: DifficultySetting): string {
  return DIFFICULTY_LABELS[value];
}

/** Couleur d'avatar déterministe, dérivée de l'id du joueur. */
export function avatarColor(playerId: string): string {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] as string;
}

/** Initiale affichée dans l'avatar. */
export function avatarInitial(nickname: string): string {
  const trimmed = nickname.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
}

/** `"Sarah"` déjà pris → `"Sarah2"`, `"Sarah3"`… */
export function suggestNickname(nickname: string, taken: ReadonlySet<string>): string {
  const base = nickname.trim();
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}${Date.now() % 1000}`;
}
