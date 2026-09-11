import {
  RELAY_SNAPSHOT_VERSION,
  dealPictoCards,
  type Game,
  type Player,
  type PlayerId,
  type PlayerRound,
  type RelayAssignment,
  type RelayHandoffPayload,
  type RelayPhase,
  type RelayPlayer,
  type RelayRound,
  type RelaySnapshot,
  type Rng,
  type Round,
  type Slot,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from '../game/factory';
import { createSessionToken, sha256Hex } from '../random';

/**
 * L'instantané de relais : construction et adoption.
 *
 * Ce module est le jumeau de `playerView.ts`, et il obéit à la même doctrine,
 * pour la même raison. Ce qu'il produit part sur le réseau, vers des joueurs
 * qui sont précisément les adversaires de ceux dont il décrit l'état.
 *
 * ─── Liste blanche, jamais filtrage ───
 *
 * Chaque objet est construit **champ par champ** dans un objet neuf. On ne
 * copie jamais un objet existant pour en retirer ensuite ce qui est secret :
 * c'est exactement l'erreur que `persistence.ts` peut se permettre — son
 * `{ ...player }` ne quitte pas l'appareil de l'hôte — et que ce fichier ne
 * peut pas se permettre. Un champ ajouté à `Player` demain ne doit pas se
 * retrouver diffusé par inadvertance.
 *
 * **Le `spread` est donc interdit ici.** Si vous en ajoutez un, vous venez
 * probablement de publier les mains de tout le monde.
 *
 * ─── La manche en cours n'est jamais transportée ───
 *
 * Parce qu'elle *est* le secret : les numéros attribués, les mains, les votes
 * en train de se former. Une reprise atterrit donc sur le classement de la
 * dernière manche **réglée**, et la manche interrompue est rejouée. C'est le
 * prix assumé pour que l'instantané soit diffusable à tout le monde.
 */

// ─────────────────────────────────────────────────────────────
//  Construction
// ─────────────────────────────────────────────────────────────

/**
 * Combien de manches sont **réglées**, donc publiables.
 *
 * Le piège est en phase `RESULTS` : `settleRound` est appliqué à l'**entrée**
 * de cette phase, pas à sa sortie. La manche en cours y est donc déjà comptée
 * dans les scores. La tronquer produirait un classement incohérent — des
 * points par manche arrêtés à N−1, et un cumul incluant N.
 */
export function settledRoundCount(game: Game): number {
  switch (game.phase) {
    case 'LOBBY':
      return 0;
    case 'RESULTS':
    case 'SCOREBOARD':
    case 'FINAL_RESULTS':
      return game.currentRound;
    default:
      // IDENTITY_REVEAL, CLUE_SELECTION, GUESSING : la manche en cours n'a
      // encore rien rapporté à personne.
      return Math.max(0, game.currentRound - 1);
  }
}

/** La phase sur laquelle une reprise atterrira. */
export function coerceRelayPhase(game: Game): RelayPhase {
  if (game.phase === 'FINAL_RESULTS') return 'FINAL_RESULTS';
  return settledRoundCount(game) > 0 ? 'SCOREBOARD' : 'LOBBY';
}

export interface BuildRelayOptions {
  /** Génération d'hébergement courante. */
  epoch: number;
  /** Compteur monotone de l'émetteur, pour départager deux instantanés. */
  seq: number;
  now?: number;
  /**
   * Empreintes déjà calculées, par joueur.
   *
   * `sha256Hex` est asynchrone et le jeton d'un joueur ne change jamais :
   * recalculer huit empreintes à chaque diffusion ferait travailler pour rien
   * le téléphone qui a déjà le plus à faire.
   */
  hashCache?: Map<PlayerId, string>;
}

export async function buildRelaySnapshot(
  game: Game,
  options: BuildRelayOptions,
): Promise<RelaySnapshot> {
  const now = options.now ?? Date.now();
  const settled = settledRoundCount(game);
  const phase = coerceRelayPhase(game);
  // Un salon n'a ni score ni carte : la cohérence est un invariant validé à la
  // réception, autant la produire ici plutôt que de la laisser au hasard.
  const lobby = phase === 'LOBBY';

  const players: RelayPlayer[] = [];
  for (const player of playersInJoinOrder(game)) {
    players.push({
      id: player.id,
      nickname: player.nickname,
      score: lobby ? 0 : player.score,
      joinedAt: player.joinedAt,
      sessionHash: await sessionHashOf(player, options.hashCache),
      cardsLeft: lobby ? 0 : player.hand.length,
    });
  }

  return {
    v: RELAY_SNAPSHOT_VERSION,
    code: game.code,
    hostId: game.hostId,
    phase,
    currentRound: lobby ? 0 : settled,
    settings: {
      clueSeconds: game.settings.clueSeconds,
      guessSeconds: game.settings.guessSeconds,
      difficulty: game.settings.difficulty,
    },
    players,
    rounds: lobby ? [] : game.rounds.slice(0, settled).map(toRelayRound),
    usedIdentityIds: [...game.usedIdentityIds],
    bannedNicknames: [...game.bannedNicknames],
    epoch: options.epoch,
    seq: options.seq,
    issuedAt: now,
  };
}

async function sessionHashOf(
  player: Player,
  cache: Map<PlayerId, string> | undefined,
): Promise<string> {
  const cached = cache?.get(player.id);
  if (cached) return cached;

  const hash = await sha256Hex(player.sessionToken);
  cache?.set(player.id, hash);
  return hash;
}

/**
 * Une manche réglée.
 *
 * `slot` et `votes` sont conservés, et c'est délibéré malgré l'apparence : une
 * fois la manche réglée, les numéros ont été révélés à tout le monde. Il en
 * reste un résidu — *qui* s'est trompé sur *qui*, ce que la révélation ne
 * publie pas — sans la moindre valeur pour les manches restantes. On l'accepte
 * parce que sans lui les statistiques de fin de partie (meilleur détective,
 * meilleur donneur d'indices) deviendraient fausses plutôt qu'absentes : le
 * calcul verrait des votes vides et désignerait un vainqueur au hasard.
 *
 * `placed` en revanche ne sert plus à rien une fois la manche réglée, et il
 * porte les identifiants de cartes : il est jeté.
 */
function toRelayRound(round: Round): RelayRound {
  const assignments: Array<[PlayerId, RelayAssignment]> = [];

  for (const [playerId, assignment] of round.assignments) {
    const votes: Record<PlayerId, Slot> = {};
    for (const [voterId, slot] of Object.entries(assignment.votes)) {
      // Un auto-vote n'existe pas dans le jeu et il est rejeté à la réception :
      // on ne le transporte pas, plutôt que de faire refuser tout l'instantané.
      if (voterId === playerId) continue;
      votes[voterId] = slot;
    }

    assignments.push([
      playerId,
      {
        slot: assignment.slot,
        votes,
        roundScoreGiven: assignment.roundScoreGiven,
        roundScoreGuessed: assignment.roundScoreGuessed,
      },
    ]);
  }

  return {
    roundNumber: round.roundNumber,
    board: [...round.board],
    assignments,
  };
}

// ─────────────────────────────────────────────────────────────
//  Passation
// ─────────────────────────────────────────────────────────────

export interface RelayHandoff {
  connectionId: string;
  payload: RelayHandoffPayload;
}

/**
 * À qui envoyer l'instantané, et avec quel rang.
 *
 * Le rang est ce qui départage la reprise : le joueur de rang 0 tente en
 * premier, les suivants après un délai croissant. Sans lui, tous les survivants
 * se rueraient au même instant sur l'identifiant de signalisation — un seul
 * gagnerait de toute façon, mais on paierait plusieurs allers-retours inutiles
 * au courtier avant de le savoir.
 *
 * `excludeConnectionId` est le nœud qui héberge : la file doit répondre à
 * « qui reprend si **moi** je disparais ». Le moteur ne sait pas lequel c'est —
 * `game.hostId` désigne l'hôte du salon, pas celui du moteur — donc c'est
 * l'appelant qui le lui dit.
 */
export function buildRelayHandoffs(
  game: Game,
  snapshot: RelaySnapshot,
  excludeConnectionId?: string,
): RelayHandoff[] {
  const successors = playersInJoinOrder(game).filter(
    (player) =>
      player.connected &&
      player.connectionId !== null &&
      player.connectionId !== excludeConnectionId,
  );

  return successors.map((player, rank) => ({
    connectionId: player.connectionId as string,
    payload: { snapshot, rank, successors: successors.length },
  }));
}

// ─────────────────────────────────────────────────────────────
//  Adoption
// ─────────────────────────────────────────────────────────────

export interface AdoptRelayOptions {
  rng: Rng;
  now?: number;
  /**
   * Le joueur qui reprend l'hébergement.
   *
   * Sert à lui donner le salon si l'ancien hôte de salon est justement celui
   * qui a disparu. Sans ça, la partie repartirait avec des boutons « lancer »
   * et « manche suivante » appartenant à un fantôme — et plus personne ne
   * pourrait avancer.
   */
  selfPlayerId?: PlayerId;
}

/**
 * Reconstruit un état de jeu à partir d'un instantané.
 *
 * L'instantané est supposé **déjà validé** (`parseRelaySnapshot`) : ce qui
 * suit reconstruit, il ne contrôle plus.
 *
 * Trois choses méritent l'attention :
 *
 * 1. **Tout le monde revient déconnecté.** C'est exact — les canaux de l'ancien
 *    hôte n'existent plus — et c'est ce qui met la partie en pause le temps que
 *    chacun se rebranche, plutôt que de la faire avancer dans le vide.
 *
 * 2. **Les horodatages sont réécrits sur l'horloge locale.** Les horloges des
 *    pairs sont désynchronisées — c'est tout l'objet de `measureClockOffset` —
 *    et un `lastActivityAt` en retard de plus de deux heures ferait purger la
 *    partie fraîchement adoptée par la boucle de nettoyage. Seul l'**ordre**
 *    d'arrivée est conservé, puisque c'est tout ce que le code en lit.
 *
 * 3. **Les mains sont redistribuées à l'identique en nombre, à neuf en
 *    contenu.** Le budget de cartes est ce qui départage le classement : le
 *    perdre serait une injustice visible. Les images, elles, ne peuvent pas
 *    être restituées — elles n'ont jamais quitté l'ancien hôte.
 */
export function adoptRelaySnapshot(snapshot: RelaySnapshot, options: AdoptRelayOptions): Game {
  const now = options.now ?? Date.now();
  const rng = options.rng;
  const epoch = snapshot.epoch + 1;

  const ordered = [...snapshot.players].sort((a, b) => a.joinedAt - b.joinedAt);
  const players = new Map<PlayerId, Player>();

  ordered.forEach((source, index) => {
    players.set(source.id, {
      id: source.id,
      // Un jeton neuf, imprévisible : celui d'avant n'a jamais été transmis.
      // Il sera remplacé par le vrai dès que le joueur présentera le sien.
      sessionToken: createSessionToken(),
      sessionTokenHash: source.sessionHash,
      connectionId: null,
      nickname: source.nickname,
      score: source.score,
      hand: dealPictoCards(
        {
          cardCount: source.cardsLeft,
          // La génération entre dans le préfixe : sans elle, une soumission
          // partie juste avant la coupure pourrait valider par collision
          // d'identifiant sur la nouvelle main.
          idPrefix: `${source.id}-e${epoch}-`,
        },
        rng,
      ),
      connected: false,
      disconnectedAt: now,
      // Décalages d'une milliseconde : seul l'ordre compte, et il est préservé.
      joinedAt: now - (ordered.length - index),
    });
  });

  const game: Game = {
    code: snapshot.code,
    hostId: resolveHostId(snapshot, players, options.selfPlayerId),
    phase: snapshot.phase,
    currentRound: snapshot.currentRound,
    settings: {
      clueSeconds: snapshot.settings.clueSeconds,
      guessSeconds: snapshot.settings.guessSeconds,
      difficulty: snapshot.settings.difficulty,
    },
    players,
    rounds: snapshot.rounds.map(toRound),
    usedIdentityIds: new Set(snapshot.usedIdentityIds),
    bannedNicknames: new Set(snapshot.bannedNicknames),
    createdAt: now,
    lastActivityAt: now,
    // La pause est posée par l'appelant, qui seul peut armer l'échéance
    // d'abandon qui va avec.
    pausedAt: null,
    epoch,
  };

  return game;
}

/**
 * Qui tient le salon après la reprise.
 *
 * On garde l'hôte du salon s'il est toujours dans la partie — il reviendra
 * peut-être, et lui retirer son rôle sans raison serait arbitraire. S'il a
 * disparu de la liste, c'est l'adoptant qui le prend : c'est le seul dont on
 * soit certain qu'il est là, puisqu'il est en train d'héberger.
 */
function resolveHostId(
  snapshot: RelaySnapshot,
  players: Map<PlayerId, Player>,
  selfPlayerId: PlayerId | undefined,
): PlayerId {
  if (players.has(snapshot.hostId)) return snapshot.hostId;
  if (selfPlayerId && players.has(selfPlayerId)) return selfPlayerId;

  // Ni l'un ni l'autre : le plus ancien fera l'affaire, et la partie reste
  // pilotable. `players` est déjà dans l'ordre d'arrivée.
  const first = players.keys().next();
  return first.done ? snapshot.hostId : first.value;
}

/** Une manche réglée, remise en forme pour le moteur. */
function toRound(source: RelayRound): Round {
  const assignments = new Map<PlayerId, PlayerRound>();

  for (const [playerId, assignment] of source.assignments) {
    assignments.set(playerId, {
      slot: assignment.slot,
      // Les boîtiers ne sont pas transportés : plus rien ne les lit une fois la
      // manche réglée, et ils portent des identifiants de cartes.
      placed: [],
      cluesSubmitted: true,
      votes: { ...assignment.votes },
      votesSubmitted: true,
      roundScoreGiven: assignment.roundScoreGiven,
      roundScoreGuessed: assignment.roundScoreGuessed,
    });
  }

  return {
    roundNumber: source.roundNumber,
    phase: 'RESULTS',
    phaseEndsAt: null,
    board: [...source.board],
    assignments,
  };
}
