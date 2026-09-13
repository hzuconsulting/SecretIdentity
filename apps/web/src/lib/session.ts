'use client';

import { SESSION_STORAGE_KEY, type SessionPayload } from '@identite-secrete/shared';

/**
 * Sessions stockées dans le `localStorage`, **indexées par code de partie**.
 *
 * Une seule entrée globale poserait problème dès qu'on ouvre deux parties
 * depuis le même navigateur : la seconde écraserait la première, et actualiser
 * l'onglet de la première ferait revenir le joueur dans la mauvaise partie.
 *
 * Attention en test manuel : deux onglets d'une même fenêtre **partagent** ce
 * stockage. Pour simuler quatre joueurs sur une machine, il faut quatre
 * contextes distincts (fenêtre privée, autre navigateur, autre profil).
 */

type SessionMap = Record<string, SessionPayload>;

function readAll(): SessionMap {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SessionMap) : {};
  } catch {
    // Stockage corrompu ou refusé (navigation privée verrouillée) : on repart
    // d'une carte vide plutôt que de casser la page.
    return {};
  }
}

function writeAll(sessions: SessionMap): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Le stockage peut être plein ou interdit. La partie reste jouable, mais
    // actualiser la page fera repasser par le formulaire de pseudo.
  }
}

export function loadSession(code: string): SessionPayload | null {
  return readAll()[code.toUpperCase()] ?? null;
}

export function saveSession(session: SessionPayload): void {
  const sessions = readAll();
  sessions[session.code.toUpperCase()] = session;
  writeAll(sessions);
}

export function clearSession(code: string): void {
  const sessions = readAll();
  delete sessions[code.toUpperCase()];
  writeAll(sessions);
}

// ─────────────────────────────────────────────────────────────
//  Dernière partie active — pour proposer d'y revenir
// ─────────────────────────────────────────────────────────────

/**
 * Pointeur vers la dernière partie où ce navigateur a été connecté.
 *
 * Il vit à côté de la carte des sessions, sans la modifier : la carte ne dit
 * pas laquelle est la plus récente (l'ordre des clés d'un objet n'est pas
 * fiable — un code tout en chiffres passerait devant les autres), et une
 * session peut traîner des heures après la fin d'une partie dont l'hôte a
 * fermé l'onglet. Le pointeur porte donc une date, rafraîchie tant qu'on joue.
 */
const RECENT_STORAGE_KEY = `${SESSION_STORAGE_KEY}:recent`;

/**
 * Au-delà, on ne propose plus de revenir. Même ordre de grandeur que la purge
 * des parties inactives côté moteur : une partie muette depuis plus longtemps
 * n'existe très probablement plus.
 */
const RECENT_MAX_AGE_MS = 2 * 60 * 60 * 1_000;

interface RecentPointer {
  code: string;
  at: number;
}

export interface LatestSession {
  session: SessionPayload;
  /** Dernière fois qu'on a été connecté à cette partie (ms epoch). */
  lastActiveAt: number;
}

/** Note que ce navigateur est connecté à la partie `code`, maintenant. */
export function markSessionActive(code: string): void {
  if (typeof window === 'undefined') return;

  const pointer: RecentPointer = { code: code.toUpperCase(), at: Date.now() };
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(pointer));
  } catch {
    // Sans stockage, on ne proposera simplement pas de revenir.
  }
}

/**
 * La partie la plus récemment active, si sa session existe toujours.
 *
 * Lecture seule. Rend `null` si on a quitté la partie (session effacée), si
 * elle est trop ancienne, ou si le stockage est illisible.
 */
export function latestSession(maxAgeMs: number = RECENT_MAX_AGE_MS): LatestSession | null {
  if (typeof window === 'undefined') return null;

  let pointer: RecentPointer | null = null;
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as RecentPointer).code === 'string' &&
      typeof (parsed as RecentPointer).at === 'number'
    ) {
      pointer = parsed as RecentPointer;
    }
  } catch {
    return null;
  }

  if (!pointer || Date.now() - pointer.at > maxAgeMs) return null;

  const session = loadSession(pointer.code);
  return session ? { session, lastActiveAt: pointer.at } : null;
}
