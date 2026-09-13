import {
  CLIENT_EVENTS,
  MIN_PLAYERS,
  fail,
  nextRoundSchema,
  ok,
  replaySchema,
  startGameSchema,
  submitCluesSchema,
  submitGuessesSchema,
  updateSettingsSchema,
  type Game,
} from '@identite-secrete/shared';
import { touch } from '../game/factory';
import { connectedCount, isHost } from '../game/lobby';
import { samePlacement, validatePlacement } from '../game/clues';
import { sameVotes, validateVotes } from '../game/guesses';
import { currentRound, opponentIdsFor } from '../game/round';
import { broadcastState, toastAll } from '../emit';
import type { EventHandler } from './context';

/**
 * Déroulé d'une partie : réglages du salon, lancement, soumissions, enchaînement.
 *
 * Chaque gestionnaire suit le même ordre de contrôles : session, pause, rôle,
 * phase, puis validation du contenu. Les trois premiers protègent l'état, le
 * dernier protège les règles — et aucun n'écrit quoi que ce soit avant d'avoir
 * tout vérifié.
 *
 * Ces contrôles restent indispensables en pair à pair, et pour la même raison
 * qu'avant : le nœud hôte reçoit des messages fabriqués par d'autres
 * navigateurs, qu'il ne contrôle pas. Un client modifié reste un client.
 */

// ─────────────────────────────────────────────────────────────
//  Paramètres — hôte uniquement, salon uniquement
// ─────────────────────────────────────────────────────────────

const updateSettings: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.updateSettings, async () => {
    const { store, emitter } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!isHost(game, playerId)) return fail('NOT_HOST');
    if (game.phase !== 'LOBBY') return fail('WRONG_PHASE');

    const parsed = updateSettingsSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_PAYLOAD', {
        message: parsed.error.issues[0]?.message ?? 'Paramètre invalide.',
      });
    }

    const now = Date.now();
    game.settings = { ...game.settings, ...parsed.data };
    touch(game, now);
    await store.save(game);

    broadcastState(emitter, game, now);
    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Lancement de la partie — hôte uniquement, salon uniquement
// ─────────────────────────────────────────────────────────────

const startGame: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.startGame, async () => {
    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!startGameSchema.safeParse(payload ?? {}).success) return fail('INVALID_PAYLOAD');
    if (!isHost(game, playerId)) return fail('NOT_HOST');

    // Idempotent : un double clic ne relance pas la manche 1.
    if (game.phase !== 'LOBBY') return fail('WRONG_PHASE');
    if (connectedCount(game) < MIN_PLAYERS) return fail('NOT_ENOUGH_PLAYERS');

    await ctx.deps.engine.start(game);
    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Manche suivante — hôte uniquement, une fois la manche révélée
// ─────────────────────────────────────────────────────────────

const nextRound: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.nextRound, async () => {
    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!nextRoundSchema.safeParse(payload ?? {}).success) return fail('INVALID_PAYLOAD');
    if (!isHost(game, playerId)) return fail('NOT_HOST');
    if (game.pausedAt !== null) return fail('GAME_PAUSED');

    // Il n'y a plus de minuteur après une manche : c'est ce bouton, et lui seul,
    // qui fait avancer. Depuis la révélation dans le déroulé normal, ou depuis le
    // classement quand une reprise après migration y a atterri.
    const { engine } = ctx.deps;
    if (!engine.isBetweenRounds(game.phase)) return fail('WRONG_PHASE');

    // `advance` revérifie la phase : un double appui ne saute pas une manche.
    await engine.advance(game, game.phase);
    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Soumission des indices
// ─────────────────────────────────────────────────────────────

const submitClues: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.submitClues, async () => {
    const { store, emitter, engine } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;

    const parsed = submitCluesSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_PAYLOAD', {
        message: parsed.error.issues[0]?.message ?? 'Sélection invalide.',
      });
    }

    if (game.pausedAt !== null) return fail('GAME_PAUSED');
    if (game.phase !== 'CLUE_SELECTION') {
      // La manche a déjà avancé : le message doit dire que c'est le temps qui a
      // manqué, pas que l'action était illégitime.
      return isAfterClueSelection(game.phase) ? fail('TOO_LATE') : fail('WRONG_PHASE');
    }

    const round = currentRound(game);
    const assignment = round?.assignments.get(playerId);
    const player = game.players.get(playerId);
    if (!round || !assignment || !player) return fail('WRONG_PHASE');

    // La main est celle du joueur, pas celle de la manche : elle traverse la
    // partie et ne contient plus ce qu'il a déjà dépensé.
    const validation = validatePlacement(parsed.data.placed, player.hand);
    if (!validation.ok) {
      return fail(
        validation.code,
        validation.message ? { message: validation.message } : undefined,
      );
    }

    if (assignment.cluesSubmitted) {
      // Rejouer exactement la même soumission est sans effet et réussit ; en
      // changer une après validation est refusé.
      return samePlacement(assignment.placed, validation.placed)
        ? ok(null)
        : fail('WRONG_PHASE', { message: 'Ton boîtier est déjà validé.' });
    }

    const now = Date.now();
    assignment.placed = validation.placed;
    assignment.cluesSubmitted = true;
    touch(game, now);
    await store.save(game);

    // Diffuse la progression, puis vérifie si on peut conclure la phase sans
    // attendre le minuteur.
    broadcastState(emitter, game, now);
    await engine.advanceIfComplete(game);

    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Soumission des devinettes
// ─────────────────────────────────────────────────────────────

const submitGuesses: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.submitGuesses, async () => {
    const { store, emitter, engine } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;

    const parsed = submitGuessesSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_PAYLOAD', {
        message: parsed.error.issues[0]?.message ?? 'Réponses invalides.',
      });
    }

    if (game.pausedAt !== null) return fail('GAME_PAUSED');
    if (game.phase !== 'GUESSING') {
      return isAfterGuessing(game.phase) ? fail('TOO_LATE') : fail('WRONG_PHASE');
    }

    const round = currentRound(game);
    const assignment = round?.assignments.get(playerId);
    if (!round || !assignment) return fail('WRONG_PHASE');

    // La liste des adversaires est recalculée ici, pas reprise du client :
    // c'est ce qui empêche de voter pour soi-même.
    const validation = validateVotes(parsed.data.votes, opponentIdsFor(game, round, playerId));
    if (!validation.ok) {
      return fail(
        validation.code,
        validation.message ? { message: validation.message } : undefined,
      );
    }

    if (assignment.votesSubmitted) {
      return sameVotes(assignment.votes, validation.votes)
        ? ok(null)
        : fail('WRONG_PHASE', { message: 'Tes votes sont déjà validés.' });
    }

    const now = Date.now();
    assignment.votes = validation.votes;
    assignment.votesSubmitted = true;
    touch(game, now);
    await store.save(game);

    broadcastState(emitter, game, now);
    await engine.advanceIfComplete(game);

    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Rejouer — hôte uniquement, depuis la fin de partie
// ─────────────────────────────────────────────────────────────

const replay: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.replay, async () => {
    const { store, emitter, engine } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!replaySchema.safeParse(payload ?? {}).success) return fail('INVALID_PAYLOAD');
    if (!isHost(game, playerId)) return fail('NOT_HOST');
    if (game.phase !== 'FINAL_RESULTS') return fail('WRONG_PHASE');

    const now = Date.now();
    engine.cancel(game.code);

    // Mêmes joueurs, mêmes réglages, scores remis à zéro. `usedIdentityIds` est
    // **conservé** : sinon la partie suivante commencerait souvent par
    // redistribuer les identités qu'on vient de jouer (§9).
    //
    // Les absents, eux, ne suivent pas au salon : leur place n'était gardée que
    // pour la partie qui vient de finir, et un salon plein de fantômes
    // empêcherait d'autres joueurs d'entrer.
    for (const player of [...game.players.values()]) {
      if (player.away) game.players.delete(player.id);
    }
    for (const player of game.players.values()) player.score = 0;
    game.rounds = [];
    game.currentRound = 0;
    game.phase = 'LOBBY';
    touch(game, now);

    await store.save(game);
    toastAll(emitter, game, 'Nouvelle partie : retour au salon.', 'success');
    broadcastState(emitter, game, now);

    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Utilitaires de phase
// ─────────────────────────────────────────────────────────────

/** Phases qui suivent la sélection d'indices, dans la même manche. */
function isAfterClueSelection(phase: Game['phase']): boolean {
  return (
    phase === 'GUESSING' ||
    phase === 'RESULTS' ||
    phase === 'SCOREBOARD' ||
    phase === 'FINAL_RESULTS'
  );
}

/** Phases qui suivent la devinette, dans la même manche. */
function isAfterGuessing(phase: Game['phase']): boolean {
  return phase === 'RESULTS' || phase === 'SCOREBOARD' || phase === 'FINAL_RESULTS';
}

// ─────────────────────────────────────────────────────────────

export const roundHandlers: Record<string, EventHandler> = {
  [CLIENT_EVENTS.updateSettings]: updateSettings,
  [CLIENT_EVENTS.startGame]: startGame,
  [CLIENT_EVENTS.nextRound]: nextRound,
  [CLIENT_EVENTS.submitClues]: submitClues,
  [CLIENT_EVENTS.submitGuesses]: submitGuesses,
  [CLIENT_EVENTS.replay]: replay,
};
