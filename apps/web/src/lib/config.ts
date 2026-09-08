/**
 * Préfixe d'URL du site.
 *
 * Vide sur un domaine dédié. Sur GitHub Pages, le site vit dans un sous-dossier
 * au nom du dépôt : `/identite-secrete`. Le manifeste, le service worker et les
 * liens de partage doivent en tenir compte.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Préfixe des identifiants de signalisation.
 *
 * Le code de partie **est** l'identifiant que l'hôte réserve auprès du service
 * de signalisation : c'est ce qui remplace l'annuaire de salons que tenait le
 * serveur. L'espace de noms du courtier public est partagé par toutes les
 * applications qui l'utilisent, d'où le préfixe — sans lui, `K7P4Q` entrerait
 * en collision avec le premier venu.
 *
 * Il porte un numéro de version : le jour où le format des messages change,
 * l'incrémenter empêche un ancien onglet de parler à un nouveau.
 */
const PEER_ID_PREFIX = 'identite-secrete-v1-';

export function peerIdForCode(code: string): string {
  return `${PEER_ID_PREFIX}${code.toUpperCase()}`;
}

/**
 * Service de signalisation.
 *
 * Il ne sert **qu'à la mise en relation** : une fois le canal WebRTC ouvert,
 * les messages de jeu vont directement d'un téléphone à l'autre et ne passent
 * plus par lui. Vide, on utilise le courtier public de PeerJS, ce qui permet un
 * déploiement sans aucune infrastructure.
 *
 * Pour reprendre la main dessus (courtier public saturé, réseau d'entreprise
 * qui le bloque), lancer un `peerjs` quelque part et renseigner ces variables
 * au build — elles sont inlinées par Next, un changement impose de reconstruire.
 */
export interface SignalingConfig {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
}

function readSignalingConfig(): SignalingConfig {
  const host = process.env.NEXT_PUBLIC_PEER_HOST;
  if (!host) return {};

  const port = Number(process.env.NEXT_PUBLIC_PEER_PORT);

  return {
    host,
    ...(Number.isFinite(port) && port > 0 ? { port } : {}),
    path: process.env.NEXT_PUBLIC_PEER_PATH || '/',
    ...(process.env.NEXT_PUBLIC_PEER_KEY ? { key: process.env.NEXT_PUBLIC_PEER_KEY } : {}),
    secure: process.env.NEXT_PUBLIC_PEER_SECURE !== 'false',
  };
}

export const SIGNALING = readSignalingConfig();

/**
 * Serveurs ICE.
 *
 * Les STUN publics suffisent au cas courant — tout le monde dans le même salon,
 * sur le même Wi-Fi. Ils ne suffisent pas derrière certains NAT symétriques
 * (typiquement deux réseaux mobiles différents) : il faut alors un relais TURN,
 * qui ne peut pas être gratuit puisqu'il fait transiter le trafic.
 *
 * `NEXT_PUBLIC_ICE_SERVERS` accepte le tableau JSON attendu par WebRTC, par
 * exemple :
 *   [{"urls":"turn:mon-turn:3478","username":"u","credential":"p"}]
 * Il **remplace** la liste par défaut.
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

function readIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as RTCIceServer[];
  } catch {
    // Configuration illisible : on garde les STUN par défaut plutôt que de
    // partir sans aucun serveur ICE, ce qui casserait toute connexion.
  }

  return DEFAULT_ICE_SERVERS;
}

export const ICE_SERVERS = readIceServers();

/** Délai au-delà duquel une action sans réponse est déclarée perdue. */
export const REQUEST_TIMEOUT_MS = 8_000;
