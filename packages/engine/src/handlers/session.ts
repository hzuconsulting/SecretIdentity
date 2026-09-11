import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  createGameSchema,
  fail,
  gameError,
  joinGameSchema,
  kickPlayerSchema,
  ok,
  pingSchema,
  rejoinGameSchema,
  type Game,
  type PlayerId,
  type PongPayload,
  type SessionPayload,
} from '@identite-secrete/shared';
import { logger } from '../logger';
import { createGame, createPlayer } from '../game/factory';
import {
  addPlayer,
  banNickname,
  checkCanJoin,
  isHost,
  markDisconnected,
  markReconnected,
  removePlayer,
  transferHost,
} from '../game/lobby';
import { timerKeys } from '../timers';
import { broadcastState, sendStateTo, toastAll } from '../emit';
import { sha256Hex } from '../random';
import { finalizeGame, type EventHandler, type HandlerContext, type HandlerDeps } from './context';

/**
 * Cycle de vie d'un joueur : entrer dans une partie, en sortir, y revenir.
 *
 * Tout ce qui touche à la session vit ici, y compris les deux échéances qui
 * suivent une déconnexion — retrait après la période de grâce, et transfert du
 * rôle d'hôte.
 *
 * Note pair à pair : le rôle d'« hôte » manipulé ici est celui du **salon** —
 * qui règle la partie et la lance. Ce n'est pas nécessairement le nœud qui
 * héberge le moteur : les deux coïncident au départ, mais un transfert de
 * salon ne déplace pas le moteur.
 */

// ─────────────────────────────────────────────────────────────
//  Synchronisation d'horloge
// ─────────────────────────────────────────────────────────────

const ping: EventHandler = async (_ctx, payload) => {
  const parsed = pingSchema.safeParse(payload);
  if (!parsed.success) return fail('INVALID_PAYLOAD');

  const pong: PongPayload = { clientTime: parsed.data.clientTime, serverTime: Date.now() };
  return ok(pong);
};

// ─────────────────────────────────────────────────────────────
//  Création
// ─────────────────────────────────────────────────────────────

const createGameHandler: EventHandler = (ctx, payload) =>
  ctx.guard<SessionPayload>(CLIENT_EVENTS.createGame, async () => {
    const { store, rng, emitter, fixedCode } = ctx.deps;

    const parsed = createGameSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_NICKNAME', {
        message: parsed.error.issues[0]?.message ?? 'Ce pseudo ne convient pas.',
      });
    }

    const now = Date.now();
    const host = createPlayer(parsed.data.nickname, ctx.connectionId, now);
    const game = createGame({
      host,
      usedCodes: await store.usedCodes(),
      rng,
      now,
      // En pair à pair, le code a déjà été réservé auprès du service de
      // signalisation : le tirage a lieu avant, pas ici.
      ...(fixedCode ? { code: fixedCode } : {}),
    });

    await store.create(game);
    ctx.bind(game.code, host.id);

    logger.info(`Partie ${game.code} créée par ${host.nickname}`);
    sendStateTo(emitter, game, host.id, ctx.connectionId, now);

    return ok({ sessionToken: host.sessionToken, playerId: host.id, code: game.code });
  });

// ─────────────────────────────────────────────────────────────
//  Jointure
// ─────────────────────────────────────────────────────────────

const joinGame: EventHandler = (ctx, payload) =>
  ctx.guard<SessionPayload>(CLIENT_EVENTS.joinGame, async () => {
    const { store, emitter } = ctx.deps;

    const parsed = joinGameSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_PAYLOAD', {
        message: parsed.error.issues[0]?.message ?? 'Requête invalide.',
      });
    }

    const { code, nickname } = parsed.data;
    const game = await store.get(code);
    if (!game) return fail('GAME_NOT_FOUND');

    const rejection = checkCanJoin(game, nickname);
    if (rejection) {
      return rejection.reason === 'NICKNAME_TAKEN'
        ? fail('NICKNAME_TAKEN', { suggestion: rejection.suggestion })
        : fail(rejection.reason);
    }

    const now = Date.now();
    const player = createPlayer(nickname, ctx.connectionId, now);
    addPlayer(game, player, now);
    await store.save(game);
    ctx.bind(game.code, player.id);

    logger.info(`${nickname} rejoint ${game.code} (${game.players.size} joueurs)`);
    broadcastState(emitter, game, now);

    return ok({ sessionToken: player.sessionToken, playerId: player.id, code: game.code });
  });

// ─────────────────────────────────────────────────────────────
//  Reconnexion
// ─────────────────────────────────────────────────────────────

const rejoinGame: EventHandler = (ctx, payload) =>
  ctx.guard<SessionPayload>(CLIENT_EVENTS.rejoinGame, async () => {
    const { store, timers, emitter, engine } = ctx.deps;

    const parsed = rejoinGameSchema.safeParse(payload);
    if (!parsed.success) return fail('INVALID_PAYLOAD');

    const found = await resolveSession(store, parsed.data.sessionToken);
    if (!found) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = found;
    const now = Date.now();

    // Le joueur revient : on annule son retrait et, s'il était hôte, le
    // transfert programmé.
    timers.cancel(timerKeys.drop(game.code, playerId));
    if (isHost(game, playerId)) timers.cancel(timerKeys.hostTransfer(game.code));

    markReconnected(game, playerId, ctx.connectionId, now);
    await store.save(game);
    ctx.bind(game.code, playerId);

    const player = game.players.get(playerId);
    logger.info(`${player?.nickname ?? playerId} revient dans ${game.code}`);
    broadcastState(emitter, game, now);

    // Assez de monde est revenu : la manche repart où elle en était.
    await engine.resumeIfPossible(game);

    return ok({
      sessionToken: parsed.data.sessionToken,
      playerId,
      code: game.code,
    });
  });

/**
 * Retrouve la session d'un joueur, par jeton ou par empreinte.
 *
 * Le chemin direct est celui de toujours. Le second n'existe qu'après une
 * reprise d'hébergement : le nouvel hôte n'a jamais reçu les jetons — les
 * diffuser aurait permis à n'importe qui d'usurper n'importe qui, donc de lire
 * son numéro secret — seulement leurs empreintes SHA-256.
 *
 * Le joueur présente donc son jeton, qu'il a toujours dans son propre stockage,
 * et c'est l'empreinte qui est comparée. Dès que la correspondance est établie,
 * **le vrai jeton remplace le provisoire** et l'empreinte est effacée : la
 * partie retrouve son fonctionnement normal, et l'engagement ne traîne pas
 * comme une seconde porte d'entrée.
 */
async function resolveSession(
  store: HandlerDeps['store'],
  sessionToken: string,
): Promise<{ game: Game; playerId: PlayerId } | null> {
  const direct = await store.findBySessionToken(sessionToken);
  if (direct) return direct;

  const hash = await sha256Hex(sessionToken);
  const byCommitment = await store.findBySessionCommitment(hash);
  if (!byCommitment) return null;

  const player = byCommitment.game.players.get(byCommitment.playerId);
  if (!player) return null;

  player.sessionToken = sessionToken;
  delete player.sessionTokenHash;
  await store.save(byCommitment.game);

  logger.info(`${player.nickname} reconnu·e par empreinte dans ${byCommitment.game.code}`);
  return byCommitment;
}

// ─────────────────────────────────────────────────────────────
//  Départ volontaire
// ─────────────────────────────────────────────────────────────

const leave: EventHandler = (ctx) =>
  ctx.guard<null>(CLIENT_EVENTS.leave, async () => {
    const { timers, emitter, engine } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return ok(null); // déjà parti : idempotent

    const { game, playerId } = context;
    const now = Date.now();
    const player = game.players.get(playerId);
    const wasHost = isHost(game, playerId);

    timers.cancel(timerKeys.drop(game.code, playerId));
    removePlayer(game, playerId, now);
    ctx.unbind();

    // Départ volontaire : le transfert d'hôte est immédiat (§9).
    if (wasHost) {
      timers.cancel(timerKeys.hostTransfer(game.code));
      const transfer = transferHost(game, now);
      if (transfer) {
        toastAll(emitter, game, `${transfer.newHostNickname} est le nouvel hôte.`, 'info');
      }
    }

    if (player) {
      toastAll(emitter, game, `${player.nickname} a quitté la partie.`, 'info');
    }

    await ctx.finalize(game, now);
    await engine.pauseIfNeeded(game);
    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Exclusion par l'hôte
// ─────────────────────────────────────────────────────────────

/**
 * L'hôte sort un joueur de la partie.
 *
 * Même chemin qu'un départ volontaire — retrait, toast, `finalize`, pause
 * éventuelle — à trois détails près : l'exclu est prévenu par un événement qui
 * lui est propre **avant** d'être retiré (après, on n'aurait plus sa
 * connexion), son pseudo est banni, et il n'y a jamais de transfert d'hôte à
 * gérer puisque l'hôte ne peut pas s'exclure lui-même.
 *
 * Disponible en cours de partie, pas seulement au salon : un joueur qui gâche
 * la soirée ne le fait pas qu'avant le lancement. La manche en cours se termine
 * normalement, son boîtier est révélé sous « Joueur parti », et la partie se met
 * en pause s'il ne reste plus assez de monde.
 */
const kickPlayer: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.kickPlayer, async () => {
    const { timers, emitter, engine } = ctx.deps;

    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const { game, playerId } = context;
    if (!isHost(game, playerId)) return fail('NOT_HOST');

    const parsed = kickPlayerSchema.safeParse(payload);
    if (!parsed.success) return fail('INVALID_PAYLOAD');

    const targetId = parsed.data.playerId;
    if (targetId === playerId) {
      return fail('INVALID_PAYLOAD', { message: 'Tu ne peux pas t’exclure toi-même.' });
    }

    const target = game.players.get(targetId);
    if (!target) return ok(null); // déjà parti : idempotent

    const now = Date.now();

    // Prévenir avant de retirer : ensuite, `connectionId` n'est plus accessible.
    if (target.connected && target.connectionId) {
      emitter.emit(target.connectionId, SERVER_EVENTS.kicked, gameError('KICKED'));
    }

    timers.cancel(timerKeys.drop(game.code, targetId));
    removePlayer(game, targetId, now);
    banNickname(game, target);

    logger.info(`${target.nickname} exclu de ${game.code} par l'hôte`);
    toastAll(emitter, game, `${target.nickname} a été exclu·e de la partie.`, 'warning');

    await ctx.finalize(game, now);
    if (!(await engine.pauseIfNeeded(game))) {
      // L'exclu était peut-être le dernier qu'on attendait : la phase peut se
      // conclure sans lui, sans quoi tout le monde patienterait jusqu'au bout
      // du minuteur pour un joueur qui n'existe plus.
      await engine.advanceIfComplete(game);
    }

    return ok(null);
  });

// ─────────────────────────────────────────────────────────────
//  Déconnexion subie
// ─────────────────────────────────────────────────────────────

/**
 * Appelée par le `GameHost` quand un canal se ferme. Ce n'est pas un événement
 * client : elle ne renvoie pas d'acquittement et ne consomme pas de débit.
 */
export async function handleDisconnect(ctx: HandlerContext, reason: string): Promise<void> {
  const { store, emitter, engine } = ctx.deps;

  const context = await ctx.resolveContext();
  if (!context) return;

  const { game, playerId } = context;
  const now = Date.now();
  const player = game.players.get(playerId);

  // Le joueur s'est déjà reconnecté sur un autre canal : cette fermeture est
  // celle de l'ancien, arrivée en retard. La traiter le déclarerait absent
  // alors qu'il est là — un cas fréquent en WebRTC, où le nouveau canal
  // s'ouvre souvent avant que l'ancien n'annonce sa fermeture.
  if (player && player.connectionId !== null && player.connectionId !== ctx.connectionId) {
    return;
  }

  markDisconnected(game, playerId, now);
  await store.save(game);

  // Deux effets possibles, dans cet ordre : s'il ne reste plus assez de monde,
  // on gèle la partie ; sinon, s'il était le dernier attendu, la phase peut se
  // conclure sans attendre son minuteur.
  if (!(await engine.pauseIfNeeded(game))) {
    await engine.advanceIfComplete(game);
  }

  logger.debug(`${player?.nickname ?? playerId} déconnecté de ${game.code} (${reason})`);
  broadcastState(emitter, game, now);

  armAbsenceTimers(ctx.deps, game, playerId);
}

/**
 * Arme les deux échéances qui suivent l'absence d'un joueur.
 *
 * Sans `playerId`, arme celles de **tous** les absents : c'est le cas après une
 * reprise d'hébergement, où tout le monde revient déconnecté et où aucun
 * `handleDisconnect` n'a eu lieu.
 *
 * Les oublier n'est pas un détail. Le transfert d'hôte de salon, en
 * particulier, est un **verrou mortel** : `game.hostId` désignerait toujours le
 * joueur disparu, et comme `startGame`, `nextRound`, `replay`,
 * `updateSettings` et `kickPlayer` exigent tous d'être hôte, plus personne ne
 * pourrait faire avancer la partie.
 */
export function armAbsenceTimers(deps: HandlerDeps, game: Game, playerId?: PlayerId): void {
  const { timers } = deps;

  const absentees =
    playerId !== undefined
      ? [playerId]
      : [...game.players.values()].filter((player) => !player.connected).map((p) => p.id);

  for (const id of absentees) {
    // Période de grâce : la partie continue sans lui, il peut revenir.
    timers.schedule(timerKeys.drop(game.code, id), deps.disconnectGraceMs, () => {
      void dropAfterGrace(deps, game.code, id);
    });
  }

  // L'hôte garde son rôle un moment : une coupure de tunnel de métro ne doit
  // pas lui coûter le contrôle du salon.
  const host = game.players.get(game.hostId);
  if (host && !host.connected) {
    timers.schedule(timerKeys.hostTransfer(game.code), deps.hostTransferDelayMs, () => {
      void transferHostAfterDelay(deps, game.code);
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  Échéances de déconnexion
// ─────────────────────────────────────────────────────────────

async function dropAfterGrace(
  deps: HandlerDeps,
  code: string,
  playerId: PlayerId,
): Promise<void> {
  const { store, timers, emitter, engine } = deps;

  const game = await store.get(code);
  if (!game) return;

  const player = game.players.get(playerId);
  // Il est revenu entre-temps : rien à faire.
  if (!player || player.connected) return;

  const now = Date.now();
  const wasHost = isHost(game, playerId);
  removePlayer(game, playerId, now);

  if (wasHost) {
    timers.cancel(timerKeys.hostTransfer(code));
    const transfer = transferHost(game, now);
    if (transfer) {
      toastAll(emitter, game, `${transfer.newHostNickname} est le nouvel hôte.`, 'info');
    }
  }

  toastAll(emitter, game, `${player.nickname} a quitté la partie.`, 'info');
  logger.info(`${player.nickname} retiré de ${code} (absence prolongée)`);

  await finalizeGame(deps, game, now);
  await engine.pauseIfNeeded(game);
}

async function transferHostAfterDelay(deps: HandlerDeps, code: string): Promise<void> {
  const { store, emitter } = deps;

  const game = await store.get(code);
  if (!game) return;

  const host = game.players.get(game.hostId);
  // L'hôte est revenu : on ne touche à rien.
  if (!host || host.connected) return;

  const now = Date.now();
  const transfer = transferHost(game, now);
  if (!transfer) return;

  await store.save(game);
  toastAll(
    emitter,
    game,
    `${transfer.previousHostNickname} est déconnecté·e. ${transfer.newHostNickname} devient hôte.`,
    'warning',
  );
  broadcastState(emitter, game, now);
  logger.info(`Hôte de ${code} transféré à ${transfer.newHostNickname}`);
}

// ─────────────────────────────────────────────────────────────

export const sessionHandlers: Record<string, EventHandler> = {
  [CLIENT_EVENTS.ping]: ping,
  [CLIENT_EVENTS.createGame]: createGameHandler,
  [CLIENT_EVENTS.joinGame]: joinGame,
  [CLIENT_EVENTS.rejoinGame]: rejoinGame,
  [CLIENT_EVENTS.leave]: leave,
  [CLIENT_EVENTS.kickPlayer]: kickPlayer,
};
