import {
  MIN_PLAYERS,
  TOTAL_ROUNDS,
  type Game,
  type OpponentCase,
  type PlayerId,
  type PlayerRound,
  type PlayerView,
  type PublicPlayer,
  type RevealedVote,
  type Round,
  type RoundReveal,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from '../game/factory';
import { buildStandings, buildStats } from './scoreboard';
import { currentRound, identityOf, opponentIdsFor } from '../game/round';

/**
 * Construction des vues par joueur — le point le plus important du projet (§4.4).
 *
 * **Règle absolue : aucun objet `Game` brut ne doit jamais atteindre un socket.**
 * Tout ce qui part vers un client passe par ici.
 *
 * Ce module ne connaît qu'un seul mécanisme de sécurité : la **liste blanche**.
 * On construit un objet neuf champ par champ, on ne filtre jamais un objet
 * existant. Un champ ajouté à `Game` demain n'apparaîtra donc pas ici par
 * accident.
 *
 * Ce que le joueur P reçoit, phase par phase :
 *
 * - `LOBBY` — joueurs, réglages, hôte.
 * - `IDENTITY_REVEAL` — le **plateau** (les huit personnages sont publics, comme
 *   au centre de la table) et **son seul numéro**. Jamais celui des autres.
 * - `CLUE_SELECTION` — en plus, sa main de cartes, son boîtier en cours, et la
 *   progression **booléenne** des autres. Jamais leurs mains ni leurs numéros.
 * - `GUESSING` — les boîtiers des adversaires, **nommés** : dans les règles, on
 *   vote en regardant le boîtier posé devant chacun. Toujours pas leurs numéros.
 * - `RESULTS` — tout est révélé.
 * - `SCOREBOARD` / `FINAL_RESULTS` — classement, puis statistiques.
 */

/** Projection publique d'un joueur : rien de secret ne peut en sortir. */
export function toPublicPlayer(game: Game, playerId: PlayerId): PublicPlayer | null {
  const player = game.players.get(playerId);
  if (!player) return null;

  return {
    id: player.id,
    nickname: player.nickname,
    score: player.score,
    // Le nombre de cartes restantes, jamais lesquelles : autour d'une table, on
    // voit bien la main de l'autre fondre sans voir ce qu'elle contient.
    cardsLeft: player.hand.length,
    connected: player.connected,
    isHost: game.hostId === player.id,
  };
}

export function buildPlayerView(
  game: Game,
  playerId: PlayerId,
  now: number,
): PlayerView | null {
  const you = toPublicPlayer(game, playerId);
  if (!you) return null;

  const players = playersInJoinOrder(game)
    .map((player) => toPublicPlayer(game, player.id))
    .filter((player): player is PublicPlayer => player !== null);

  const round = currentRound(game);

  const view: PlayerView = {
    code: game.code,
    // Génération d'hébergement : permet au client de reconnaître une vue
    // émise par un hôte périmé et de l'ignorer (D-74).
    epoch: game.epoch,
    phase: game.phase,
    roundNumber: game.currentRound,
    totalRounds: TOTAL_ROUNDS,
    phaseEndsAt: round?.phaseEndsAt ?? null,
    serverTime: now,
    settings: { ...game.settings },
    you,
    players,
  };

  if (game.pausedAt !== null) {
    view.paused = true;
    view.pauseReason = `Il faut au moins ${MIN_PLAYERS} joueurs connectés pour continuer.`;
  }

  if (!round) return view;

  const mine = round.assignments.get(playerId) ?? null;

  switch (game.phase) {
    case 'IDENTITY_REVEAL':
      addBoard(view, round);
      addOwnIdentity(view, round, playerId, mine);
      addOwnHand(view, game, playerId, mine);
      break;

    case 'CLUE_SELECTION':
      addBoard(view, round);
      addOwnIdentity(view, round, playerId, mine);
      addOwnHand(view, game, playerId, mine);
      view.progress = buildProgress(game, round, 'clues');
      break;

    case 'GUESSING':
      addBoard(view, round);
      addOwnIdentity(view, round, playerId, mine);
      addVotingMaterial(view, game, round, playerId, mine);
      view.progress = buildProgress(game, round, 'votes');
      break;

    case 'RESULTS':
      addBoard(view, round);
      addOwnIdentity(view, round, playerId, mine);
      view.reveals = buildReveals(game, round);
      view.roundScores = buildStandings(game, [round]);
      break;

    case 'SCOREBOARD':
      view.standings = buildStandings(game, [round]);
      break;

    case 'FINAL_RESULTS':
      // Le détail porte sur toute la partie. Construit à partir d'une seule
      // manche absente, il affichait « +0 » partout sous un total pourtant juste.
      view.standings = buildStandings(game, game.rounds);
      view.stats = buildStats(game);
      break;

    case 'LOBBY':
      break;
  }

  return view;
}

// ─────────────────────────────────────────────────────────────
//  Blocs de la vue
// ─────────────────────────────────────────────────────────────

/**
 * Le plateau — **public**.
 *
 * Les huit personnages sont face visible au centre de la table : les envoyer à
 * tout le monde n'est pas une fuite, c'est la règle. Ce qui reste secret, c'est
 * qui porte quel numéro.
 */
function addBoard(view: PlayerView, round: Round): void {
  view.board = [...round.board];
}

function addOwnIdentity(
  view: PlayerView,
  round: Round,
  playerId: PlayerId,
  mine: PlayerRound | null,
): void {
  if (!mine) return;
  view.yourSlot = mine.slot;

  const identityId = identityOf(round, playerId);
  if (identityId) view.yourIdentityId = identityId;
}

function addOwnHand(
  view: PlayerView,
  game: Game,
  playerId: PlayerId,
  mine: PlayerRound | null,
): void {
  const player = game.players.get(playerId);
  if (!player) return;

  view.yourHand = player.hand.map((card) => ({ ...card }));
  view.yourPlaced = (mine?.placed ?? []).map((picto) => ({ ...picto }));
  view.yourCluesSubmitted = mine?.cluesSubmitted ?? false;
}

/**
 * Matériel de la phase de vote.
 *
 * Une seule exclusion, contre deux auparavant : on ne vote pas pour soi. Les
 * **huit** numéros du plateau restent proposables, y compris ceux que personne
 * ne porte — c'est exactement ce qui empêche de résoudre par élimination quand
 * on joue à trois.
 *
 * Les boîtiers sont **nommés** : le livret fait voter en regardant le boîtier
 * posé devant chaque joueur. On envoie donc le pseudo avec les pictogrammes,
 * jamais le numéro.
 */
function addVotingMaterial(
  view: PlayerView,
  game: Game,
  round: Round,
  playerId: PlayerId,
  mine: PlayerRound | null,
): void {
  const opponents: OpponentCase[] = [];

  for (const opponentId of opponentIdsFor(game, round, playerId)) {
    const assignment = round.assignments.get(opponentId);
    const opponent = game.players.get(opponentId);
    if (!assignment || !opponent) continue;

    opponents.push({
      playerId: opponentId,
      nickname: opponent.nickname,
      // Seulement l'image et la zone : la carte d'origine ne sort jamais.
      placed: assignment.placed.map(({ iconId, zone }) => ({ iconId, zone })),
    });
  }

  view.opponents = opponents;
  view.yourVotes = { ...(mine?.votes ?? {}) };
  view.yourVotesSubmitted = mine?.votesSubmitted ?? false;
}

/**
 * Progression : uniquement des booléens.
 *
 * On envoie « Allan a validé », jamais « Allan a validé ⚡🐍🏜️ ». Un joueur qui
 * inspecte le trafic réseau n'apprend rien de plus qu'en regardant l'écran de
 * son voisin.
 */
function buildProgress(
  game: Game,
  round: Round,
  kind: 'clues' | 'votes',
): PlayerView['progress'] {
  const progress: NonNullable<PlayerView['progress']> = [];

  for (const player of playersInJoinOrder(game)) {
    const assignment = round.assignments.get(player.id);
    if (!assignment) continue;

    progress.push({
      playerId: player.id,
      nickname: player.nickname,
      submitted: kind === 'clues' ? assignment.cluesSubmitted : assignment.votesSubmitted,
    });
  }

  return progress;
}

/** Phase RESULTS : tout est révélé, le numéro de chacun inclus. */
function buildReveals(game: Game, round: Round): RoundReveal[] {
  const possibleGuessers = Math.max(0, round.assignments.size - 1);

  const reveals: RoundReveal[] = [];

  for (const [playerId, assignment] of round.assignments) {
    const identityId = identityOf(round, playerId);
    if (!identityId) continue;

    // Le joueur a pu quitter — ou être exclu — en cours de manche : son boîtier
    // est révélé quand même (§9, « la manche se termine normalement »), sous un
    // nom générique.
    const owner = game.players.get(playerId);

    const guessedByPlayerIds: PlayerId[] = [];
    const votes: RevealedVote[] = [];

    // Dépouillement des cartes Vote posées devant lui, dans l'ordre d'arrivée
    // des votants — le même que partout ailleurs à l'écran.
    for (const voterId of votersInJoinOrder(game, round)) {
      if (voterId === playerId) continue;

      const other = round.assignments.get(voterId);
      if (!other) continue;

      const slot = other.votes[playerId] ?? null;
      const correct = slot === assignment.slot;
      if (correct) guessedByPlayerIds.push(voterId);

      votes.push({
        playerId: voterId,
        nickname: game.players.get(voterId)?.nickname ?? 'Joueur parti',
        slot,
        correct,
      });
    }

    reveals.push({
      playerId,
      nickname: owner?.nickname ?? 'Joueur parti',
      slot: assignment.slot,
      identityId,
      placed: assignment.placed.map(({ iconId, zone }) => ({ iconId, zone })),
      guessedByPlayerIds,
      votes,
      possibleGuessers,
    });
  }

  // Ordre stable et sans information : par numéro croissant, comme on
  // dépouillerait le plateau de gauche à droite.
  return reveals.sort((a, b) => a.slot - b.slot);
}

/**
 * Les votants d'une manche, dans l'ordre d'arrivée au salon.
 *
 * Ceux qui sont encore là d'abord, dans l'ordre du salon ; ceux qui sont partis
 * en cours de manche ensuite — leurs votes comptent encore, il faut les montrer.
 */
function votersInJoinOrder(game: Game, round: Round): PlayerId[] {
  const present = playersInJoinOrder(game)
    .map((player) => player.id)
    .filter((id) => round.assignments.has(id));
  const gone = [...round.assignments.keys()].filter((id) => !game.players.has(id));
  return [...present, ...gone];
}

// ─────────────────────────────────────────────────────────────
//  Diffusion
// ─────────────────────────────────────────────────────────────

/** Vues de tous les joueurs actuellement connectés, prêtes à être émises. */
export function buildConnectedViews(
  game: Game,
  now: number,
): Array<{ connectionId: string; view: PlayerView }> {
  const views: Array<{ connectionId: string; view: PlayerView }> = [];

  for (const player of game.players.values()) {
    if (!player.connected || !player.connectionId) continue;
    const view = buildPlayerView(game, player.id, now);
    if (view) views.push({ connectionId: player.connectionId, view });
  }

  return views;
}
