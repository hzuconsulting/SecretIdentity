import {
  MIN_PLAYERS,
  TOTAL_ROUNDS,
  type Game,
  type PublicPlayer,
  type Round,
  type SpectatorCase,
  type SpectatorView,
} from '@identite-secrete/shared';
import { playersInJoinOrder } from '../game/factory';
import { currentRound } from '../game/round';
import { buildReveals, toPublicPlayer } from './playerView';
import { buildStandings, buildStats } from './scoreboard';

/**
 * La vue d'un écran de suivi — la télé du salon (D-95).
 *
 * Même discipline que `playerView.ts`, et pour la même raison : **aucun objet
 * `Game` brut ne doit atteindre un canal**. On construit un objet neuf champ
 * par champ, par liste blanche ; un champ ajouté à `Game` demain n'apparaîtra
 * pas ici par accident.
 *
 * Mais la règle est ici plus stricte encore, et il faut la dire franchement :
 * **un spectateur ne s'authentifie pas.** Il suffit du code de la partie, qui
 * est écrit en haut de l'écran de chaque joueur et lu à voix haute dans la
 * pièce. Tout ce qui sort par ce chemin doit donc être considéré comme sorti
 * *vers n'importe qui*, y compris vers un joueur de la partie qui ouvrirait
 * l'écran de suivi sur un second appareil.
 *
 * D'où l'invariant, qui est la seule chose à vérifier en relisant ce fichier :
 * **chaque champ ci-dessous est déjà connu de tous les joueurs à cet instant.**
 *
 *  - `LOBBY` — qui est là, les réglages. C'est l'écran du salon.
 *  - `IDENTITY_REVEAL` — le plateau, public comme les huit cartes posées au
 *    centre de la table. Jamais qui porte quel numéro.
 *  - `CLUE_SELECTION` — en plus, **la progression seule** : « Allan a validé ».
 *    Surtout pas les pictogrammes posés, que les joueurs ne voient pas encore.
 *  - `GUESSING` — les boîtiers, nommés : à ce moment ils sont posés devant leur
 *    propriétaire et tout le monde les regarde. Toujours pas les numéros, et
 *    jamais les votes en cours.
 *  - `RESULTS` — tout est révélé, pour la table comme pour l'écran.
 *  - `SCOREBOARD` / `FINAL_RESULTS` — classement, puis statistiques.
 *
 * Ce qui n'a aucun champ où entrer, à aucune phase : un `slot` avant la
 * révélation, une main de cartes Picto, un vote non dépouillé, un jeton de
 * session. Et la discussion : elle est publique *entre joueurs*, pas sur un
 * mur — on n'affiche pas sur une télé ce qui a été écrit pour la table.
 */
export function buildSpectatorView(game: Game, now: number): SpectatorView {
  const players = playersInJoinOrder(game)
    .map((player) => toPublicPlayer(game, player.id))
    .filter((player): player is PublicPlayer => player !== null);

  const round = currentRound(game);

  const view: SpectatorView = {
    code: game.code,
    epoch: game.epoch,
    phase: game.phase,
    roundNumber: game.currentRound,
    totalRounds: TOTAL_ROUNDS,
    phaseEndsAt: round?.phaseEndsAt ?? null,
    serverTime: now,
    settings: { ...game.settings },
    players,
  };

  if (game.pausedAt !== null) {
    view.paused = true;
    view.pauseReason = `Il faut au moins ${MIN_PLAYERS} joueurs connectés pour continuer.`;
  }

  if (!round) return view;

  switch (game.phase) {
    case 'IDENTITY_REVEAL':
      view.board = [...round.board];
      break;

    case 'CLUE_SELECTION':
      view.board = [...round.board];
      // `false` : les pictogrammes ne sont pas encore publics.
      view.cases = buildCases(game, round, false, 'clues');
      break;

    case 'GUESSING':
      view.board = [...round.board];
      view.cases = buildCases(game, round, true, 'votes');
      break;

    case 'RESULTS':
      view.board = [...round.board];
      view.reveals = buildReveals(game, round);
      view.roundScores = buildStandings(game, [round]);
      break;

    case 'SCOREBOARD':
      view.standings = buildStandings(game, [round]);
      break;

    case 'FINAL_RESULTS':
      view.standings = buildStandings(game, game.rounds);
      view.stats = buildStats(game);
      break;

    case 'LOBBY':
      break;
  }

  return view;
}

/**
 * Les boîtiers de la manche, dans l'ordre du salon.
 *
 * `showPlaced` décide seul de ce qui sort des pictogrammes : à `false`, le
 * tableau `placed` part **vide**, il n'est pas seulement masqué à l'affichage.
 * C'est ce qui fait que regarder le trafic d'un écran de suivi pendant la pose
 * n'apprend rien de plus que de regarder l'écran lui-même.
 */
function buildCases(
  game: Game,
  round: Round,
  showPlaced: boolean,
  kind: 'clues' | 'votes',
): SpectatorCase[] {
  const cases: SpectatorCase[] = [];

  for (const player of playersInJoinOrder(game)) {
    const assignment = round.assignments.get(player.id);
    if (!assignment) continue;

    cases.push({
      playerId: player.id,
      nickname: player.nickname,
      // Seulement l'image et la zone : la carte d'origine ne sort jamais.
      placed: showPlaced
        ? assignment.placed.map(({ iconId, zone }) => ({ iconId, zone }))
        : [],
      submitted: kind === 'clues' ? assignment.cluesSubmitted : assignment.votesSubmitted,
    });
  }

  return cases;
}
