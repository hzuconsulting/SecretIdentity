import {
  CLIENT_EVENTS,
  createGameSchema,
  fail,
  joinGameSchema,
  ok,
  pingSchema,
  rejoinGameSchema,
  type PongPayload,
  type PlayerId,
  type SessionPayload,
} from '@identite-secrete/shared';
import { logger } from '../../logger';
import { createGame, createPlayer } from '../../game/factory';
import {
  addPlayer,
  checkCanJoin,
  isHost,
  markDisconnected,
  markReconnected,
  removePlayer,
  transferHost,
} from '../../game/lobby';
import { timerKeys } from '../../game/timers';
import { broadcastState, sendStateTo, toastAll } from '../emit';
import type { HandlerContext } from './context';

/**
 * Cycle de vie d'un joueur : entrer dans une partie, en sortir, y revenir.
 *
 * Tout ce qui touche à la session vit ici, y compris les deux échéances qui
 * suivent une déconnexion — retrait après la période de grâce, et transfert du
 * rôle d'hôte.
 */
export function registerSessionHandlers(ctx: HandlerContext): void {
  const { socket, deps } = ctx;
  const { io, store, timers, rng } = deps;

  // ───────────────────────────────────────────────────────────
  //  Synchronisation d'horloge
  // ───────────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.ping, (payload: unknown, ack?: (data: PongPayload) => void) => {
    const parsed = pingSchema.safeParse(payload);
    if (!parsed.success || typeof ack !== 'function') return;
    ack({ clientTime: parsed.data.clientTime, serverTime: Date.now() });
  });

  // ───────────────────────────────────────────────────────────
  //  Création
  // ───────────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.createGame, (payload: unknown, ack?: unknown) => {
    void ctx.guard<SessionPayload>(ack, CLIENT_EVENTS.createGame, async () => {
      const parsed = createGameSchema.safeParse(payload);
      if (!parsed.success) {
        return fail('INVALID_NICKNAME', {
          message: parsed.error.issues[0]?.message ?? 'Ce pseudo ne convient pas.',
        });
      }

      const now = Date.now();
      const host = createPlayer(parsed.data.nickname, socket.id, now);
      const game = createGame({ host, usedCodes: await store.usedCodes(), rng, now });

      await store.create(game);
      ctx.bind(game.code, host.id);

      logger.info(`Partie ${game.code} créée par ${host.nickname}`);
      sendStateTo(io, game, host.id, socket.id, now);

      return ok({ sessionToken: host.sessionToken, playerId: host.id, code: game.code });
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Jointure
  // ───────────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.joinGame, (payload: unknown, ack?: unknown) => {
    void ctx.guard<SessionPayload>(ack, CLIENT_EVENTS.joinGame, async () => {
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
      const player = createPlayer(nickname, socket.id, now);
      addPlayer(game, player, now);
      await store.save(game);
      ctx.bind(game.code, player.id);

      logger.info(`${nickname} rejoint ${game.code} (${game.players.size} joueurs)`);
      broadcastState(io, game, now);

      return ok({ sessionToken: player.sessionToken, playerId: player.id, code: game.code });
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Reconnexion
  // ───────────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.rejoinGame, (payload: unknown, ack?: unknown) => {
    void ctx.guard<SessionPayload>(ack, CLIENT_EVENTS.rejoinGame, async () => {
      const parsed = rejoinGameSchema.safeParse(payload);
      if (!parsed.success) return fail('INVALID_PAYLOAD');

      const found = await store.findBySessionToken(parsed.data.sessionToken);
      if (!found) return fail('SESSION_NOT_FOUND');

      const { game, playerId } = found;
      const now = Date.now();

      // Le joueur revient : on annule son retrait et, s'il était hôte, le
      // transfert programmé.
      timers.cancel(timerKeys.drop(game.code, playerId));
      if (isHost(game, playerId)) timers.cancel(timerKeys.hostTransfer(game.code));

      markReconnected(game, playerId, socket.id, now);
      await store.save(game);
      ctx.bind(game.code, playerId);

      const player = game.players.get(playerId);
      logger.info(`${player?.nickname ?? playerId} revient dans ${game.code}`);
      broadcastState(io, game, now);

      // Assez de monde est revenu : la manche repart où elle en était.
      await deps.engine.resumeIfPossible(game);

      return ok({
        sessionToken: parsed.data.sessionToken,
        playerId,
        code: game.code,
      });
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Départ volontaire
  // ───────────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.leave, (_payload: unknown, ack?: unknown) => {
    void ctx.guard<null>(ack, CLIENT_EVENTS.leave, async () => {
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
          toastAll(io, game, `${transfer.newHostNickname} est le nouvel hôte.`, 'info');
        }
      }

      if (player) {
        toastAll(io, game, `${player.nickname} a quitté la partie.`, 'info');
      }

      await ctx.finalize(game, now);
      await deps.engine.pauseIfNeeded(game);
      return ok(null);
    });
  });

  // ───────────────────────────────────────────────────────────
  //  Déconnexion subie
  // ───────────────────────────────────────────────────────────

  socket.on('disconnect', (reason: string) => {
    void (async () => {
      const context = await ctx.resolveContext();
      if (!context) return;

      const { game, playerId } = context;
      const now = Date.now();
      const player = game.players.get(playerId);

      markDisconnected(game, playerId, now);
      await store.save(game);

      // Deux effets possibles, dans cet ordre : s'il ne reste plus assez de
      // monde, on gèle la partie ; sinon, s'il était le dernier attendu, la
      // phase peut se conclure sans attendre son minuteur.
      if (!(await deps.engine.pauseIfNeeded(game))) {
        await deps.engine.advanceIfComplete(game);
      }

      logger.debug(`${player?.nickname ?? playerId} déconnecté de ${game.code} (${reason})`);
      broadcastState(io, game, now);

      // Période de grâce : la partie continue sans lui, il peut revenir.
      timers.schedule(timerKeys.drop(game.code, playerId), deps.disconnectGraceMs, () => {
        void dropAfterGrace(game.code, playerId);
      });

      // L'hôte garde son rôle un moment : une coupure de tunnel de métro ne
      // doit pas lui coûter le contrôle du salon.
      if (isHost(game, playerId)) {
        timers.schedule(timerKeys.hostTransfer(game.code), deps.hostTransferDelayMs, () => {
          void transferHostAfterDelay(game.code);
        });
      }
    })();
  });

  // ───────────────────────────────────────────────────────────
  //  Échéances de déconnexion
  // ───────────────────────────────────────────────────────────

  async function dropAfterGrace(code: string, playerId: PlayerId): Promise<void> {
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
        toastAll(io, game, `${transfer.newHostNickname} est le nouvel hôte.`, 'info');
      }
    }

    toastAll(io, game, `${player.nickname} a quitté la partie.`, 'info');
    logger.info(`${player.nickname} retiré de ${code} (absence prolongée)`);

    await ctx.finalize(game, now);
    await deps.engine.pauseIfNeeded(game);
  }

  async function transferHostAfterDelay(code: string): Promise<void> {
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
      io,
      game,
      `${transfer.previousHostNickname} est déconnecté·e. ${transfer.newHostNickname} devient hôte.`,
      'warning',
    );
    broadcastState(io, game, now);
    logger.info(`Hôte de ${code} transféré à ${transfer.newHostNickname}`);
  }
}
