'use client';

import { SOUND_STORAGE_KEY } from '@identite-secrete/shared';

/**
 * Sons du jeu.
 *
 * **Aucun fichier audio.** Tout est synthétisé à la volée avec l'API Web Audio :
 * zéro octet à charger, zéro licence à gérer, et des sons qui démarrent
 * instantanément — un fichier de 20 ko qui arrive après le clic ne sert à rien.
 *
 * Trois règles tenues ici :
 *  - jamais de lecture au chargement de la page ; un son ne part qu'en réaction
 *    à un événement de jeu ;
 *  - aucune musique de fond ;
 *  - tout est coupable d'un bouton, et le choix est mémorisé.
 *
 * Le contexte audio n'est créé qu'au premier son demandé. Les navigateurs
 * bloquent l'audio tant que l'utilisateur n'a pas interagi avec la page : les
 * tout premiers sons d'une session peuvent donc être muets, jusqu'au premier
 * appui. C'est le comportement voulu par les navigateurs, on ne le contourne pas.
 */

export type SoundName =
  | 'select'
  | 'deselect'
  | 'confirm'
  | 'join'
  | 'phase'
  | 'reveal'
  | 'correct'
  | 'wrong'
  | 'urgent'
  | 'win';

interface Tone {
  /** Fréquence en Hz. */
  frequency: number;
  /** Décalage de départ, en secondes. */
  at: number;
  /** Durée, en secondes. */
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

/** Chaque son tient en moins de 600 ms : on ponctue, on n'accompagne pas. */
const SOUNDS: Record<SoundName, Tone[]> = {
  select: [{ frequency: 660, at: 0, duration: 0.07 }],
  deselect: [{ frequency: 440, at: 0, duration: 0.06, gain: 0.5 }],
  confirm: [
    { frequency: 523, at: 0, duration: 0.09 },
    { frequency: 784, at: 0.08, duration: 0.14 },
  ],
  join: [{ frequency: 880, at: 0, duration: 0.1 }],
  phase: [
    { frequency: 392, at: 0, duration: 0.1 },
    { frequency: 587, at: 0.09, duration: 0.14 },
  ],
  reveal: [{ frequency: 494, at: 0, duration: 0.16, gain: 0.6 }],
  correct: [
    { frequency: 523, at: 0, duration: 0.08 },
    { frequency: 659, at: 0.07, duration: 0.08 },
    { frequency: 784, at: 0.14, duration: 0.18 },
  ],
  wrong: [{ frequency: 196, at: 0, duration: 0.22, type: 'triangle', gain: 0.5 }],
  urgent: [
    { frequency: 330, at: 0, duration: 0.08, type: 'square', gain: 0.35 },
    { frequency: 330, at: 0.14, duration: 0.08, type: 'square', gain: 0.35 },
  ],
  win: [
    { frequency: 523, at: 0, duration: 0.11 },
    { frequency: 659, at: 0.1, duration: 0.11 },
    { frequency: 784, at: 0.2, duration: 0.11 },
    { frequency: 1047, at: 0.3, duration: 0.3 },
  ],
};

// ─────────────────────────────────────────────────────────────
//  Préférence, partagée par toute l'application
// ─────────────────────────────────────────────────────────────

let enabled = true;
let hydrated = false;
const listeners = new Set<() => void>();

function readPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(SOUND_STORAGE_KEY);
    // Par défaut activé : un jeu de soirée muet perd la moitié de son énergie,
    // et le bouton de coupure est visible en permanence dans l'en-tête.
    return raw === null ? true : raw === 'on';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  if (!hydrated && typeof window !== 'undefined') {
    enabled = readPreference();
    hydrated = true;
  }
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  hydrated = true;

  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Stockage indisponible : la préférence vaut pour la session seulement.
  }

  for (const listener of listeners) listener();
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─────────────────────────────────────────────────────────────
//  Lecture
// ─────────────────────────────────────────────────────────────

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }

  // Le navigateur suspend le contexte tant qu'aucune interaction n'a eu lieu.
  if (context.state === 'suspended') void context.resume();

  return context;
}

export function playSound(name: SoundName): void {
  if (!isSoundEnabled()) return;

  const ctx = audioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  for (const tone of SOUNDS[name]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = tone.type ?? 'sine';
    oscillator.frequency.setValueAtTime(tone.frequency, now + tone.at);

    // Enveloppe douce : une attaque brutale « claque » sur un haut-parleur de
    // téléphone, et une coupure nette produit un clic audible.
    const peak = 0.18 * (tone.gain ?? 1);
    gain.gain.setValueAtTime(0.0001, now + tone.at);
    gain.gain.exponentialRampToValueAtTime(peak, now + tone.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(now + tone.at);
    oscillator.stop(now + tone.at + tone.duration + 0.02);
  }
}
