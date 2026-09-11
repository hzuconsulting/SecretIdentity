'use client';

import { SERVER_EVENTS, type RelayHandoffPayload } from '@identite-secrete/shared';
import { loadSession } from '@/lib/session';
import { recordAttempt } from './connectionLog';
import { clearHostedGame } from './hostStorage';
import { HostNode } from './hostNode';
import type { GameNode } from './node';
import { clearRelay, loadRelay, saveRelay } from './relayStorage';

/**
 * La reprise d'hébergement, côté client.
 *
 * Quand l'hôte disparaît pour de bon, un des joueurs restants doit prendre sa
 * place. Tout le matériel nécessaire est déjà là : chacun a reçu un instantané
 * assaini (`relayStorage.ts`), et le moteur sait l'adopter (`GameHost.adopt`).
 * Il ne reste qu'à décider **qui**, et **quand**.
 *
 * ─── Qui ───
 *
 * Le rang, attribué par l'hôte dans l'ordre d'arrivée, et transmis à chacun
 * avec l'instantané. Le rang 0 tente en premier, les suivants après un délai
 * croissant. Ce n'est pas un protocole d'élection et ça n'a pas à en être un :
 * la réservation de l'identifiant auprès du courtier est atomique, donc le
 * pire cas d'une collision de rangs reste « les deux tentent, un seul gagne ».
 * Le rang n'est là que pour éviter de payer plusieurs allers-retours inutiles.
 *
 * ─── Quand ───
 *
 * C'est la partie délicate, parce que le coût d'une erreur n'est pas symétrique.
 * Reprendre trop tôt, pendant que l'hôte rafraîchissait simplement sa page,
 * c'est **lui voler la partie** — et son état était plus récent que le nôtre,
 * donc on perd la manche en cours pour rien. Reprendre trop tard, c'est laisser
 * tout le monde devant un sablier.
 *
 * D'où l'exigence cumulée : le statut `host-gone` du nœud invité (qui demande
 * déjà une série d'échecs **et** vingt secondes), puis une dernière tentative
 * de connexion juste avant de se lancer. Si l'hôte est revenu entre-temps, on
 * abandonne.
 */

/** Délai avant la première tentative, après le verdict « hôte parti ». */
const MIGRATION_BASE_MS = 1_000;

/**
 * Écart entre deux rangs.
 *
 * Doit couvrir le temps qu'il faut au gagnant pour réserver l'identifiant *et*
 * au suivant pour constater qu'il est pris. Une réservation est un aller-retour
 * au courtier ; un échec `unavailable-id`, lui, revient vite.
 */
const MIGRATION_STEP_MS = 2_500;

/**
 * Au-delà de ce rang, on ne tente rien.
 *
 * Sans ce plafond, le huitième joueur attendrait vingt secondes de plus que le
 * premier, pour une reprise que quelqu'un aura de toute façon faite. Les rangs
 * écartés continuent simplement de composer le code : dès que le gagnant a
 * réservé l'identifiant, ils retombent sur lui tout seuls.
 */
const MIGRATION_MAX_RANK = 2;

export interface MigrationWatch {
  stop(): void;
}

export interface MigrationHooks {
  /** Appelé quand cet onglet est devenu l'hôte. */
  onMigrated(node: HostNode): void;
  /** Appelé quand la partie est définitivement perdue pour cet onglet. */
  onGiveUp?(): void;
}

/**
 * Surveille un nœud invité et reprend la partie si son hôte disparaît.
 *
 * Ne fait rien tant que le nœud n'annonce pas `host-gone` — un statut qui, à lui
 * seul, exige déjà une longue série d'échecs et une durée minimale.
 */
export function watchForMigration(
  node: GameNode,
  hooks: MigrationHooks,
): MigrationWatch {
  let stopped = false;
  let attempting = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const code = node.code;

  const onRelay = (payload: RelayHandoffPayload) => {
    saveRelay(code, payload);
  };

  const onStatus = (status: string) => {
    if (stopped || status !== 'host-gone' || attempting) return;

    const stored = loadRelay(code);
    if (!stored) {
      // Aucun instantané : soit l'hôte tournait une version qui n'en émet pas,
      // soit on n'a jamais été connecté assez longtemps pour en recevoir un.
      hooks.onGiveUp?.();
      return;
    }

    const rank = stored.payload.rank;
    if (rank > MIGRATION_MAX_RANK) {
      // On n'est pas dans les premiers : quelqu'un d'autre va reprendre, et le
      // nœud invité se rebranchera tout seul sur lui.
      return;
    }

    attempting = true;
    timer = setTimeout(() => {
      timer = null;
      void attempt(stored.payload).finally(() => {
        attempting = false;
      });
    }, MIGRATION_BASE_MS + rank * MIGRATION_STEP_MS);
  };

  async function attempt(payload: RelayHandoffPayload): Promise<void> {
    if (stopped) return;

    // L'hôte est peut-être revenu pendant notre temporisation : le nœud invité
    // le saurait, puisqu'il n'a jamais cessé de composer le code.
    if (node.status === 'online') return;

    const session = loadSession(code);

    try {
      const adopted = await HostNode.adopt(payload.snapshot, session?.playerId);
      if (stopped) {
        adopted.close();
        return;
      }

      // Le nœud invité a fini son office : le fermer maintenant évite qu'il
      // continue de composer un identifiant que nous détenons désormais.
      node.close();
      hooks.onMigrated(adopted);
      clearRelay(code);
    } catch (cause) {
      // L'identifiant est pris : un autre joueur a repris avant nous, ce qui
      // est exactement le résultat recherché. Le nœud invité le trouvera.
      recordAttempt({
        role: 'invité',
        code,
        outcome: 'échec',
        detail: `reprise abandonnée · ${describe(cause)}`,
      });
    }
  }

  node.on<RelayHandoffPayload>(SERVER_EVENTS.relaySnapshot, onRelay);
  const unsubscribe = node.onStatus(onStatus);

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      node.off(SERVER_EVENTS.relaySnapshot, onRelay);
      unsubscribe();
    },
  };
}

/**
 * Renonce définitivement à héberger cette partie sur cet appareil.
 *
 * Appelé quand un ancien hôte n'arrive pas à reprendre son identifiant : c'est
 * qu'un autre nœud l'héberge désormais. Effacer sa sauvegarde est ce qui
 * l'empêche, plus tard, de ressusciter un état périmé — un état qui contiendrait
 * les vraies mains et les vrais numéros, et ferait remonter la partie dans le
 * temps sous les yeux de tout le monde.
 */
export function abandonHosting(code: string): void {
  clearHostedGame(code);
  recordAttempt({
    role: 'hôte',
    code,
    outcome: 'échec',
    detail: 'identifiant repris ailleurs, sauvegarde abandonnée',
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'erreur inconnue';
}
