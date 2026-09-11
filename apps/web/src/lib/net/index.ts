'use client';

import {
  CLIENT_EVENTS,
  type PongPayload,
  type SessionPayload,
} from '@identite-secrete/shared';
import { loadSession } from '@/lib/session';
import { GuestNode } from './guestNode';
import { HostNode } from './hostNode';
import { hasHostedGame } from './hostStorage';
import { abandonHosting, watchForMigration, type MigrationWatch } from './migration';
import { clearRelay } from './relayStorage';
import type { GameNode } from './node';

export type { GameNode, NodeStatus } from './node';

/**
 * Le nœud courant de l'onglet.
 *
 * Il y en a **un seul**, et il survit à la navigation entre les pages : le
 * routeur de Next ne recharge pas le document, donc le module reste vivant.
 * C'est ce qui permet de créer une partie sur `/creer` et de la retrouver sur
 * `/game` — sans quoi le moteur mourrait à la première redirection, avec la
 * partie qu'il vient de créer.
 */
let current: GameNode | null = null;

/**
 * Une ouverture en cours.
 *
 * Deux composants montés dans le même rendu — et le double montage du mode
 * strict de React en développement — appellent `getNode` en même temps. Sans
 * cette mémoire, on réserverait deux pairs pour la même partie, dont un
 * fantôme. Le code y est attaché : une demande pour une **autre** partie ne
 * doit pas recevoir le nœud de celle-ci.
 */
let opening: { code: string; promise: Promise<GameNode> } | null = null;

/**
 * La surveillance de reprise attachée au nœud courant.
 *
 * Elle ne vit que pour un nœud invité : un hôte n'a personne à remplacer.
 */
let watch: MigrationWatch | null = null;

/** Prévenus quand le nœud est remplacé sous les pieds de l'interface. */
const nodeListeners = new Set<(node: GameNode) => void>();

/**
 * S'abonne au remplacement du nœud.
 *
 * Une reprise d'hébergement échange le nœud courant : l'onglet était invité, il
 * devient hôte. Les écrans n'ont rien à changer — les deux nœuds exposent la
 * même interface — mais le hook qui tient les abonnements doit rebrancher les
 * siens sur le nouveau.
 */
export function onNodeReplaced(listener: (node: GameNode) => void): () => void {
  nodeListeners.add(listener);
  return () => nodeListeners.delete(listener);
}

function replaceNode(node: GameNode): void {
  current = node;
  stopWatching();
  for (const listener of [...nodeListeners]) listener(node);
}

function stopWatching(): void {
  watch?.stop();
  watch = null;
}

/**
 * Arme la reprise sur un nœud invité.
 *
 * On ne surveille que si cet appareil a une session sur cette partie : sans
 * elle, on n'en a jamais fait partie, et reprendre l'hébergement d'une partie
 * qu'on ne joue pas n'aurait aucun sens.
 */
function armMigration(node: GameNode): void {
  stopWatching();
  if (node.hosting || !loadSession(node.code)) return;

  watch = watchForMigration(node, {
    onMigrated: (adopted) => replaceNode(adopted),
  });
}

/**
 * Crée une partie hébergée par cet appareil.
 *
 * Retourne la session du joueur qui héberge — le même payload que renvoyait le
 * serveur, pour que la page de création n'ait pas à savoir ce qui a changé.
 */
export async function createHostedGame(nickname: string): Promise<SessionPayload> {
  closeCurrent();

  const { node, session } = await HostNode.create(nickname);
  current = node;
  return session;
}

/**
 * Rend le nœud attaché à cette partie, en l'ouvrant si besoin.
 *
 * Trois cas, dans cet ordre :
 *  1. le nœud courant joue déjà ce code — on le garde ;
 *  2. cet appareil a une sauvegarde sous ce code — il en était l'hôte, il le
 *     redevient (c'est le chemin d'un rafraîchissement de page) ;
 *  3. sinon on se connecte à l'hôte comme invité.
 */
export function getNode(code: string): Promise<GameNode> {
  const normalized = code.toUpperCase();

  if (current && current.code === normalized && current.status !== 'closed') {
    return Promise.resolve(current);
  }

  if (opening?.code === normalized) return opening.promise;

  const promise = open(normalized).finally(() => {
    if (opening?.code === normalized) opening = null;
  });

  opening = { code: normalized, promise };
  return promise;
}

async function open(code: string): Promise<GameNode> {
  closeCurrent();

  const node = hasHostedGame(code) ? await reopenAsHost(code) : await joinAsGuest(code);

  current = node;
  armMigration(node);
  return node;
}

/**
 * Se connecte comme invité, en insistant si on a déjà joué cette partie.
 *
 * La session stockée est ce qui distingue les deux situations : la posséder
 * veut dire qu'on a été admis dans cette partie, donc qu'elle a existé, donc
 * qu'un hôte absent est probablement en train de revenir. Sans elle, on est un
 * inconnu qui vient de taper un code, et lui faire patienter trente secondes
 * devant un code erroné serait une faute.
 */
function joinAsGuest(code: string): Promise<GameNode> {
  return GuestNode.connect(code, { persistent: loadSession(code) !== null });
}

/**
 * Rouvre une partie que cet appareil hébergeait.
 *
 * Si l'identifiant ne peut pas être repris malgré les tentatives, quelqu'un
 * d'autre le tient : le plus probable est que la partie a été reprise ailleurs,
 * ou que le code a été réattribué. On se rabat alors sur une connexion invitée
 * plutôt que de laisser le joueur devant une erreur technique — au pire elle
 * échoue à son tour, et le message parle de la partie, pas du courtier.
 */
async function reopenAsHost(code: string): Promise<GameNode> {
  try {
    const restored = await HostNode.restore(code);
    if (restored) return restored;
  } catch {
    // L'identifiant n'a pas pu être repris malgré les tentatives : quelqu'un
    // d'autre le tient, et le plus probable est qu'un joueur a repris la partie
    // pendant notre absence. On **abandonne définitivement** l'hébergement sur
    // cet appareil — garder la sauvegarde nous laisserait ressusciter plus tard
    // un état périmé, avec les vraies mains et les vrais numéros, et la partie
    // remonterait visiblement dans le temps.
    abandonHosting(code);
  }

  return joinAsGuest(code);
}

/** Le nœud courant, sans rien ouvrir. `null` avant la première connexion. */
export function currentNode(): GameNode | null {
  return current;
}

/** `true` si le moteur de cette partie tourne dans cet onglet. */
export function isHostingLocally(code: string): boolean {
  return current?.code === code.toUpperCase() && current.hosting;
}

/**
 * Ferme le nœud courant.
 *
 * Un hôte qui quitte volontairement efface sa sauvegarde : la partie est finie
 * pour tout le monde, et la faire revivre au prochain chargement serait pire
 * que de la perdre.
 */
export function closeCurrent(): void {
  stopWatching();
  if (current) clearRelay(current.code);
  current?.close();
  current = null;
}

/**
 * Mesure le décalage d'horloge avec l'hôte.
 *
 * `phaseEndsAt` est un timestamp de **l'hôte**. Sans cette correction, un
 * téléphone dont l'horloge avance de quarante secondes afficherait un décompte
 * faux. On ne corrige que l'affichage : la fin d'une phase reste décidée par le
 * moteur (§4.2).
 *
 * @returns le décalage en ms à **ajouter** à `Date.now()` local pour obtenir
 *          l'heure de l'hôte.
 */
export async function measureClockOffset(node: GameNode): Promise<number> {
  const clientTime = Date.now();
  const response = await node.emit<PongPayload>(CLIENT_EVENTS.ping, { clientTime });

  if (!response.ok) throw new Error(response.error.message);

  const roundTrip = Date.now() - response.data.clientTime;
  // On suppose l'aller et le retour symétriques.
  return response.data.serverTime + roundTrip / 2 - Date.now();
}
