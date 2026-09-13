import { AVATAR_COLORS } from './constants';
import type { DifficultySetting, GameVisibility, TimerSetting } from './types';

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

/** `45` → `"45 s"`, `90` → `"1 min 30"`, `120` → `"2 min"`. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')}`;
}

export function formatTimerOption(value: TimerSetting): string {
  if (value === 'auto') return 'Auto';
  return value === null ? 'Sans limite' : formatDuration(value);
}

export function formatVisibility(value: GameVisibility): string {
  return value === 'public' ? 'Publique' : 'Privée';
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

/**
 * Caractères invisibles ou trompeurs : contrôle, et surtout forçage de sens
 * d'écriture, qui sert à maquiller un texte. U+200D reste : les émojis composés
 * en ont besoin. Même liste que pour l'annuaire des parties.
 */
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Une paire de substitution complète, ou une moitié orpheline. */
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/**
 * Nettoie un message de discussion avant qu'il n'entre dans la partie.
 *
 * Les blancs, retours à la ligne compris, deviennent une espace : un message
 * tient sur une ligne, et personne ne pousse la conversation hors de l'écran à
 * coups d'Entrée. Les moitiés d'émoji orphelines disparaissent — elles
 * s'afficheraient en losange et coûtent six caractères une fois encodées.
 */
export function cleanChatText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_CHARS, '')
    .replace(SURROGATES, (match) => (match.length === 2 ? match : ''))
    .trim();
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
