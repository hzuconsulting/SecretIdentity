import {
  MIN_PLAYERS,
  type AnonymousClueSet,
  type Game,
  type PlayerId,
  type PlayerRound,
  type PlayerView,
  type PublicPlayer,
  type RevealedClueSet,
  type Round,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from '../game/factory';
import { buildStandings, buildStats } from './scoreboard';
import { currentRound, labelOf } from '../game/round';

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
 * - `IDENTITY_REVEAL` — **uniquement sa propre identité**. Ni celles des
 *   autres, ni la liste des identités en jeu.
 * - `CLUE_SELECTION` — sa main, son identité, et la progression **booléenne**
 *   des autres. Jamais leurs mains, leurs indices ni leurs identités.
 * - `GUESSING` — les N−1 séries étiquetées et les N−1 identités hors la
 *   sienne. Jamais la correspondance étiquette → joueur.
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
    phase: game.phase,
    roundNumber: game.currentRound,
    totalRounds: game.settings.rounds,
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
      addOwnIdentity(view, mine);
      break;

    case 'CLUE_SELECTION':
      addOwnIdentity(view, mine);
      addOwnHand(view, mine);
      view.progress = buildProgress(game, round, 'clues');
      break;

    case 'GUESSING':
      addOwnIdentity(view, mine);
      addGuessingMaterial(view, round, playerId, mine);
      view.progress = buildProgress(game, round, 'guesses');
      break;

    case 'RESULTS':
      addOwnIdentity(view, mine);
      view.reveals = buildReveals(game, round);
      view.roundScores = buildStandings(game, round);
      break;

    case 'SCOREBOARD':
      view.standings = buildStandings(game, round);
      break;

    case 'FINAL_RESULTS':
      view.standings = buildStandings(game, null);
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

function addOwnIdentity(view: PlayerView, mine: PlayerRound | null): void {
  if (mine) view.yourIdentityId = mine.identityId;
}

function addOwnHand(view: PlayerView, mine: PlayerRound | null): void {
  if (!mine) return;
  view.yourHand = [...mine.hand];
  view.yourSelectedIcons = [...mine.selectedIcons];
  view.yourCluesSubmitted = mine.cluesSubmitted;
}

/**
 * Matériel de la phase de devinette.
 *
 * Deux exclusions, toutes deux nécessaires à la règle du §3.1 : le joueur ne
 * voit **ni** sa propre série, **ni** sa propre identité dans la liste des
 * choix. L'appariement demandé est donc une bijection parfaite de N−1 éléments.
 *
 * Les deux listes sont triées : l'ordre ne doit rien apprendre. Trier les
 * identités par identifiant évite qu'elles arrivent dans l'ordre des joueurs.
 */
function addGuessingMaterial(
  view: PlayerView,
  round: Round,
  playerId: PlayerId,
  mine: PlayerRound | null,
): void {
  const ownLabel = labelOf(round, playerId);

  const clueSets: AnonymousClueSet[] = Object.keys(round.labelMap)
    .filter((label) => label !== ownLabel)
    .sort()
    .map((label) => {
      const ownerId = round.labelMap[label];
      const assignment = ownerId ? round.assignments.get(ownerId) : undefined;
      return { label, iconIds: [...(assignment?.selectedIcons ?? [])] };
    });

  const identityChoices = [...round.assignments.values()]
    .map((assignment) => assignment.identityId)
    .filter((identityId) => identityId !== mine?.identityId)
    .sort();

  view.clueSets = clueSets;
  view.identityChoices = identityChoices;
  view.yourGuesses = { ...(mine?.guesses ?? {}) };
  view.yourGuessesSubmitted = mine?.guessesSubmitted ?? false;
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
  kind: 'clues' | 'guesses',
): PlayerView['progress'] {
  const progress: NonNullable<PlayerView['progress']> = [];

  for (const player of playersInJoinOrder(game)) {
    const assignment = round.assignments.get(player.id);
    if (!assignment) continue;

    progress.push({
      playerId: player.id,
      nickname: player.nickname,
      submitted: kind === 'clues' ? assignment.cluesSubmitted : assignment.guessesSubmitted,
    });
  }

  return progress;
}

/** Phase RESULTS : tout est révélé, la correspondance étiquette → joueur incluse. */
function buildReveals(game: Game, round: Round): RevealedClueSet[] {
  const possibleGuessers = Math.max(0, round.assignments.size - 1);

  return Object.keys(round.labelMap)
    .sort()
    .flatMap((label): RevealedClueSet[] => {
      const ownerId = round.labelMap[label];
      if (!ownerId) return [];

      const assignment = round.assignments.get(ownerId);
      if (!assignment) return [];

      // Le joueur a pu quitter en cours de manche : sa série est révélée quand
      // même (§9, « la manche se termine normalement »), sous un nom générique.
      const owner = game.players.get(ownerId);
      const nickname = owner?.nickname ?? 'Joueur parti';

      const guessedByPlayerIds: PlayerId[] = [];
      for (const [guesserId, other] of round.assignments) {
        if (guesserId === ownerId) continue;
        if (other.guesses[label] === assignment.identityId) {
          guessedByPlayerIds.push(guesserId);
        }
      }

      return [
        {
          label,
          playerId: ownerId,
          nickname,
          identityId: assignment.identityId,
          iconIds: [...assignment.selectedIcons],
          guessedByPlayerIds,
          possibleGuessers,
        },
      ];
    });
}

// ─────────────────────────────────────────────────────────────
//  Diffusion
// ─────────────────────────────────────────────────────────────

/** Vues de tous les joueurs actuellement connectés, prêtes à être émises. */
export function buildConnectedViews(
  game: Game,
  now: number,
): Array<{ socketId: string; view: PlayerView }> {
  const views: Array<{ socketId: string; view: PlayerView }> = [];

  for (const player of game.players.values()) {
    if (!player.connected || !player.socketId) continue;
    const view = buildPlayerView(game, player.id, now);
    if (view) views.push({ socketId: player.socketId, view });
  }

  return views;
}
