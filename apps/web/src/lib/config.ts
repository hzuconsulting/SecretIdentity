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
 * Les STUN suffisent au cas courant — tout le monde dans le même salon, sur le
 * même Wi-Fi : ils apprennent à chaque pair son adresse publique, et les deux se
 * parlent ensuite directement. Ils ne suffisent pas derrière un NAT symétrique,
 * typiquement deux réseaux mobiles différents, où aucune adresse devinée ne
 * fonctionne. Il faut alors un **relais TURN**, qui fait transiter le trafic.
 *
 * Un relais public est donc inclus par défaut (D-68). Ses identifiants sont
 * volontairement en clair : dans une application sans serveur, tout ce que le
 * navigateur doit connaître est de toute façon dans le bundle. C'est un service
 * gratuit et mutualisé — il peut être lent, saturé, ou disparaître. Il est là
 * pour que le cas « deux réseaux différents » marche *par défaut*, pas pour
 * garantir un débit.
 *
 * Les trois entrées TURN ne sont pas redondantes : le port 80 passe la plupart
 * des pare-feux, le 443 ceux qui n'autorisent que le trafic chiffré, et la
 * variante `transport=tcp` les réseaux qui bloquent UDP entièrement.
 *
 * `NEXT_PUBLIC_ICE_SERVERS` accepte le tableau JSON attendu par WebRTC, par
 * exemple :
 *   [{"urls":"turn:mon-turn:3478","username":"u","credential":"p"}]
 * Il **remplace** la liste par défaut — c'est le point de branchement d'un
 * relais à soi, et la marche à suivre est dans le README.
 */
const OPEN_RELAY_CREDENTIALS = {
  username: 'openrelayproject',
  credential: 'openrelayproject',
} as const;

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', ...OPEN_RELAY_CREDENTIALS },
  { urls: 'turn:openrelay.metered.ca:443', ...OPEN_RELAY_CREDENTIALS },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', ...OPEN_RELAY_CREDENTIALS },
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

/**
 * Annuaire des parties publiques.
 *
 * Il n'y a pas de serveur pour tenir la liste des salons ouverts : l'hôte d'une
 * partie publique l'**annonce** sur un sujet ntfy.sh — un service de
 * publication gratuit, sans compte, joignable depuis le navigateur — et
 * l'accueil relit les annonces des deux dernières minutes (voir
 * `lib/net/directory.ts`). Rien de secret n'y passe : code, pseudo de l'hôte,
 * nombre de joueurs, manche en cours.
 *
 * Le sujet est public par nature : quiconque le connaît peut y écrire. Tout ce
 * qui en est lu est donc revalidé, et l'annuaire n'est qu'un raccourci — le
 * code reste la seule chose qui fait entrer dans une partie.
 *
 * `NEXT_PUBLIC_DIRECTORY_URL` remplace l'URL complète du sujet (un ntfy à soi,
 * ou un autre sujet), `off` désactive l'annuaire : plus d'annonce, plus de
 * liste. Le numéro de version du sujet suit celui du format des annonces.
 */
const DEFAULT_DIRECTORY_URL = 'https://ntfy.sh/identite-secrete-v1-parties-3k3p9bm824e';

function readDirectoryUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_DIRECTORY_URL?.trim();
  if (!raw) return DEFAULT_DIRECTORY_URL;
  if (raw.toLowerCase() === 'off') return null;

  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    }
  } catch {
    // URL illisible : on retombe sur le sujet par défaut.
  }

  return DEFAULT_DIRECTORY_URL;
}

/** URL du sujet de l'annuaire, sans barre finale. `null` : annuaire désactivé. */
export const DIRECTORY_URL = readDirectoryUrl();

/** Délai au-delà duquel une action sans réponse est déclarée perdue. */
export const REQUEST_TIMEOUT_MS = 8_000;

// ─────────────────────────────────────────────────────────────
//  Détection de coupure
// ─────────────────────────────────────────────────────────────

/**
 * Rythme du battement de cœur applicatif.
 *
 * Un canal WebRTC ne prévient pas toujours de sa mort. Le cas le plus pénible
 * n'est pas la coupure franche — elle déclenche `close` — mais le canal
 * **à moitié ouvert** : le navigateur le croit vivant, les messages partent
 * sans erreur, et rien ne revient jamais. L'invité restait alors « connecté »
 * devant un écran qui ne bouge plus.
 *
 * Ce battement ne passe pas par le moteur : c'est une enveloppe de transport
 * (`protocol.ts`), donc il ne traverse ni la table d'événements, ni les
 * schémas Zod, ni le limiteur de débit. Il ne coûte que quelques octets.
 */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * Silence au-delà duquel le canal est déclaré mort.
 *
 * Trois battements manqués. Assez court pour qu'un joueur ne reste pas devant
 * un écran figé, assez long pour encaisser une poignée de paquets perdus ou un
 * passage de tunnel.
 */
export const HEARTBEAT_TIMEOUT_MS = 16_000;

/**
 * Silence au-delà duquel l'hôte oublie un invité.
 *
 * Plus tolérant que le seuil de l'invité : c'est l'hôte qui décide qui est
 * absent, et se tromper lui coûte plus cher — il retirerait de la partie
 * quelqu'un qui est encore là. Le moteur a de toute façon sa propre période de
 * grâce par-dessus (`DISCONNECT_GRACE_MS`).
 */
export const GUEST_SILENCE_TIMEOUT_MS = 25_000;

/**
 * Durée d'échecs continus au-delà de laquelle l'hôte est déclaré parti.
 *
 * Le budget à couvrir est celui d'un **rafraîchissement de page de l'hôte** :
 * rechargement du document, import dynamique de `peerjs`, puis jusqu'à six
 * secondes de reculs dans `claimWithRetry`. Une dizaine de secondes en usage
 * normal. En deçà, on afficherait « la partie est finie » à des joueurs dont
 * l'hôte revient une seconde plus tard.
 */
export const HOST_GONE_MS = 20_000;
