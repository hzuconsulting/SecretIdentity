'use client';

import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { openPeer, supportsWebRtc } from './peer';
import { encodeMessage, parseClientMessage } from './protocol';
import { watchIce } from './iceInfo';

/**
 * Diagnostic du transport, étape par étape.
 *
 * L'appareil ouvre deux pairs et se connecte à lui-même, puis fait passer un
 * vrai message par un vrai canal WebRTC, avec la sérialisation de production.
 *
 * La version précédente ne rendait qu'un verdict global, et c'était insuffisant :
 * « ça ne transporte rien » recouvrait deux pannes sans rapport — un canal qui
 * ne s'ouvre jamais (réseau, ICE) et un canal ouvert où les données ne passent
 * pas (sérialisation). On ne pouvait pas corriger sans deviner laquelle. D'où ce
 * découpage : chaque étape rend son propre verdict, et l'étape « canal » rapporte
 * en plus l'état ICE et les types de candidats obtenus.
 *
 * ⚠ Ce que ce test **ne** prouve pas. La boucle est locale : elle ne traverse
 * aucun NAT, donc un vert ne garantit pas que deux téléphones se joindront
 * (voir D-58). Et l'inverse est vrai aussi — certains navigateurs refusent de se
 * connecter à eux-mêmes tout en fonctionnant très bien entre deux appareils. Un
 * échec à l'étape « canal » doit donc être confirmé par une vraie partie avant
 * d'en conclure quoi que ce soit.
 */

export type StepKey = 'webrtc' | 'signaling' | 'channel' | 'data';
export type StepStatus = 'ok' | 'failed' | 'skipped';

export interface DiagnosticStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  detail: string;
}

export type Outcome =
  /** Tout va bien : le canal s'ouvre et transporte les messages. */
  | 'ready'
  /** Navigateur sans WebRTC, ou page servie hors contexte sécurisé. */
  | 'no-webrtc'
  /** Le service de mise en relation ne répond pas. */
  | 'no-signaling'
  /** Les pairs s'enregistrent mais le canal ne s'ouvre jamais. Piste réseau / ICE. */
  | 'no-channel'
  /** Le canal s'ouvre mais aucun message n'arrive. Piste sérialisation. */
  | 'no-data';

export interface DiagnosticReport {
  outcome: Outcome;
  steps: DiagnosticStep[];
  /** Contexte d'exécution, à recopier quand on demande de l'aide. */
  environment: string;
}

const OPEN_TIMEOUT_MS = 15_000;
const DATA_TIMEOUT_MS = 8_000;

export async function runTransportDiagnostic(): Promise<DiagnosticReport> {
  const steps: DiagnosticStep[] = [];
  const environment = describeEnvironment();

  const push = (key: StepKey, label: string, status: StepStatus, detail: string) =>
    steps.push({ key, label, status, detail });

  const skipRest = (from: StepKey): void => {
    const order: StepKey[] = ['webrtc', 'signaling', 'channel', 'data'];
    const labels: Record<StepKey, string> = {
      webrtc: 'WebRTC disponible',
      signaling: 'Mise en relation',
      channel: 'Ouverture du canal',
      data: 'Passage d’un message',
    };
    for (const key of order.slice(order.indexOf(from))) {
      push(key, labels[key], 'skipped', 'non testé');
    }
  };

  // ── 1. WebRTC ────────────────────────────────────────────────
  if (!supportsWebRtc()) {
    push('webrtc', 'WebRTC disponible', 'failed', 'RTCPeerConnection absent');
    skipRest('signaling');
    return { outcome: 'no-webrtc', steps, environment };
  }
  push('webrtc', 'WebRTC disponible', 'ok', 'RTCPeerConnection présent');

  // ── 2. Signalisation ─────────────────────────────────────────
  let peers: [Peer, Peer];
  try {
    peers = await Promise.all([openPeer(), openPeer()]);
  } catch (cause) {
    push('signaling', 'Mise en relation', 'failed', message(cause));
    skipRest('channel');
    return { outcome: 'no-signaling', steps, environment };
  }

  const [caller, receiver] = peers;
  push('signaling', 'Mise en relation', 'ok', 'deux pairs enregistrés');

  try {
    // ── 3. Ouverture du canal ──────────────────────────────────
    const channel = await openLoopback(caller, receiver);

    if (!channel.opened) {
      push('channel', 'Ouverture du canal', 'failed', channel.detail);
      push('data', 'Passage d’un message', 'skipped', 'non testé');
      return { outcome: 'no-channel', steps, environment };
    }
    push('channel', 'Ouverture du canal', 'ok', channel.detail);

    // ── 4. Passage d'un message ────────────────────────────────
    const delivered = await sendProbe(channel.outgoing, channel.received);

    if (!delivered.ok) {
      push('data', 'Passage d’un message', 'failed', delivered.detail);
      return { outcome: 'no-data', steps, environment };
    }
    push('data', 'Passage d’un message', 'ok', delivered.detail);

    return { outcome: 'ready', steps, environment };
  } catch (cause) {
    push('channel', 'Ouverture du canal', 'failed', message(cause));
    push('data', 'Passage d’un message', 'skipped', 'non testé');
    return { outcome: 'no-channel', steps, environment };
  } finally {
    caller.destroy();
    receiver.destroy();
  }
}

/** Le verdict seul, pour le bandeau d'accueil. */
export async function runTransportSelfTest(): Promise<Outcome> {
  return (await runTransportDiagnostic()).outcome;
}

// ─────────────────────────────────────────────────────────────
//  Étapes
// ─────────────────────────────────────────────────────────────

interface Loopback {
  opened: boolean;
  detail: string;
  outgoing: DataConnection;
  /** Résolue quand le récepteur reçoit un message. */
  received: Promise<string | null>;
}

/**
 * Ouvre un canal de l'appareil vers lui-même.
 *
 * En cas d'échec, le détail rapporte l'état ICE et les types de candidats
 * obtenus : c'est ce qui distingue « aucun serveur STUN joignable » (pas de
 * candidat `srflx`) de « candidats trouvés mais aucun chemin retenu ».
 */
function openLoopback(caller: Peer, receiver: Peer): Promise<Loopback> {
  // Le récepteur est armé avant l'appel : un message ne doit pas arriver avant
  // que quelqu'un l'écoute.
  const received = new Promise<string | null>((resolve) => {
    receiver.on('connection', (incoming: DataConnection) => {
      incoming.on('data', (raw) => resolve(parseClientMessage(raw)?.event ?? null));
    });
    setTimeout(() => resolve(null), OPEN_TIMEOUT_MS + DATA_TIMEOUT_MS);
  });

  return new Promise<Loopback>((resolve) => {
    const outgoing = caller.connect(receiver.id, { reliable: true, serialization: 'raw' });
    const ice = watchIce(outgoing);

    let settled = false;
    const finish = (opened: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ice.stop();
      resolve({ opened, detail, outgoing, received });
    };

    const timeout = setTimeout(
      () => finish(false, `délai dépassé · ${ice.describe()}`),
      OPEN_TIMEOUT_MS,
    );

    outgoing.on('open', () => finish(true, ice.describe()));
    outgoing.on('error', (error) => finish(false, `${message(error)} · ${ice.describe()}`));
  });
}

/** Envoie une sonde et attend qu'elle ressorte intacte de l'autre côté. */
async function sendProbe(
  outgoing: DataConnection,
  received: Promise<string | null>,
): Promise<{ ok: boolean; detail: string }> {
  const probe = `probe-${Date.now()}`;
  const startedAt = Date.now();

  try {
    outgoing.send(encodeMessage({ t: 'req', id: 1, event: probe, payload: null }));
  } catch (cause) {
    return { ok: false, detail: `envoi refusé · ${message(cause)}` };
  }

  const timeout = new Promise<string | null>((resolve) =>
    setTimeout(() => resolve(null), DATA_TIMEOUT_MS),
  );
  const arrived = await Promise.race([received, timeout]);

  if (arrived === probe) {
    return { ok: true, detail: `aller-retour en ${Date.now() - startedAt} ms` };
  }

  return {
    ok: false,
    detail:
      arrived === null
        ? 'envoyé, jamais reçu — ce navigateur n’écrit pas sur le canal'
        : `message altéré (${arrived})`,
  };
}

// ─────────────────────────────────────────────────────────────
//  Détails
// ─────────────────────────────────────────────────────────────

function describeEnvironment(): string {
  if (typeof window === 'undefined') return 'hors navigateur';

  const secure = window.isSecureContext ? 'contexte sécurisé' : '⚠ contexte NON sécurisé';
  return `${navigator.userAgent}\n${window.location.origin} · ${secure}`;
}

function message(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'object' && cause !== null && 'type' in cause) {
    return String((cause as { type: unknown }).type);
  }
  return String(cause);
}
