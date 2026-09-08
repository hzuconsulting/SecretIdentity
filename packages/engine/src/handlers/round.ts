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
import { sameSelection, validateClueSelection } from '../game/clues';
import { sameGuesses, validateGuessSubmission } from '../game/guesses';
import { currentRound, labelOf } from '../game/round';
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
//  Manche suivante — hôte uniquement, depuis le classement
// ─────────────────────────────────────────────────────────────

const nextRound: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.nextRound, async () => {
    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!nextRoundSchema.safeParse(payload ?? {}).success) return fail('INVALID_PAYLOAD');
    if (!isHost(game, playerId)) return fail('NOT_HOST');
    if (game.pausedAt !== null) return fail('GAME_PAUSED');
    if (game.phase !== 'SCOREBOARD') return fail('WRONG_PHASE');

    // `advance` vérifie à nouveau la phase : si le minuteur des 20 secondes a
    // déjà enchaîné, l'appel devient sans effet au lieu de sauter une manche.
    await ctx.deps.engine.advance(game, 'SCOREBOARD');
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
    if (!round || !assignment) return fail('WRONG_PHASE');

    const validation = validateClueSelection(
      parsed.data.iconIds,
      assignment.hand,
      game.settings,
    );
    if (!validation.ok) {
      return fail(
        validation.code,
        validation.message ? { message: validation.message } : undefined,
      );
    }

    if (assignment.cluesSubmitted) {
      // Rejouer exactement la même soumission est sans effet et réussit ; en
      // changer une après validation est refusé.
      return sameSelection(assignment.selectedIcons, validation.iconIds)
        ? ok(null)
        : fail('WRONG_PHASE', { message: 'Tes indices sont déjà validés.' });
    }

    const now = Date.now();
    assignment.selectedIcons = validation.iconIds;
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

    // Le sous-ensemble autorisé est recalculé ici, pas repris du client : c'est
    // ce qui empêche de deviner sa propre série ou de proposer sa propre
    // identité.
    const ownLabel = labelOf(round, playerId);
    const allowedLabels = Object.keys(round.labelMap).filter((label) => label !== ownLabel);
    const allowedIdentityIds = [...round.assignments.values()]
      .map((other) => other.identityId)
      .filter((identityId) => identityId !== assignment.identityId);

    const validation = validateGuessSubmission(
      parsed.data.guesses,
      allowedLabels,
      allowedIdentityIds,
    );
    if (!validation.ok) {
      return fail(
        validation.code,
        validation.message ? { message: validation.message } : undefined,
      );
    }

    if (assignment.guessesSubmitted) {
      return sameGuesses(assignment.guesses, validation.guesses)
        ? ok(null)
        : fail('WRONG_PHASE', { message: 'Tes réponses sont déjà validées.' });
    }

    const now = Date.now();
    assignment.guesses = validation.guesses;
    assignment.guessesSubmitted = true;
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
