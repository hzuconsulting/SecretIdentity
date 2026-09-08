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
