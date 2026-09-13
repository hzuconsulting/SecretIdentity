import { CLIENT_EVENTS, fail, ok, sendChatSchema } from '@identite-secrete/shared';
import { appendChatMessage } from '../game/chat';
import type { EventHandler } from './context';

/**
 * La discussion entre les joueurs d'une partie.
 *
 * Un message suit le chemin de toute action : il entre dans l'état de l'hôte,
 * puis repart vers chacun dans sa vue. Pas d'événement à part, donc pas
 * d'historique à renvoyer à qui arrive ou revient : sa première vue le porte.
 */

/**
 * Ouvert à tout moment, pause comprise, et sans contrôle de phase : c'est un
 * choix. Écrire « je suis le 3 » en pleine manche gâcherait le jeu, mais on
 * peut aussi le dire à voix haute autour d'une vraie table ; l'écran se contente
 * de le rappeler.
 */
const sendChat: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.sendChat, async () => {
    const context = await ctx.resolveContext();
    if (!context) return fail('SESSION_NOT_FOUND');

    const parsed = sendChatSchema.safeParse(payload);
    if (!parsed.success) {
      return fail('INVALID_PAYLOAD', { message: parsed.error.issues[0]?.message });
    }

    // Après la validation : un message refusé ne consomme pas le quota.
    if (!ctx.acceptChat()) {
      return fail('RATE_LIMITED', { message: 'Tu écris trop vite. Attends quelques secondes.' });
    }

    const { game, playerId } = context;
    const author = game.players.get(playerId);
    if (!author) return fail('SESSION_NOT_FOUND');

    const now = Date.now();
    // L'auteur vient de la liaison de la connexion, jamais du message : on ne
    // peut pas écrire au nom d'un autre.
    appendChatMessage(game, { playerId, nickname: author.nickname }, parsed.data.text, now);

    await ctx.finalize(game, now);
    return ok(null);
  });

export const chatHandlers: Record<string, EventHandler> = {
  [CLIENT_EVENTS.sendChat]: sendChat,
};
