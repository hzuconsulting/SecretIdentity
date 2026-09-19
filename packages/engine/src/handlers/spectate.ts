import { CLIENT_EVENTS, fail, ok, spectateSchema } from '@identite-secrete/shared';
import { logger } from '../logger';
import { sendSpectatorViews } from '../emit';
import type { EventHandler } from './context';

/**
 * Regarder une partie sans y jouer.
 *
 * Une connexion de spectateur n'est attachée à **aucun** joueur : elle ne passe
 * jamais par `ctx.bind`, et `resolveContext` ne rendra jamais rien pour elle.
 * C'est ce qui garantit, sans aucun contrôle supplémentaire ailleurs, qu'un
 * écran de suivi ne peut ni poser un pictogramme, ni voter, ni lancer la
 * manche suivante : tous les gestionnaires de jeu commencent par réclamer un
 * joueur attaché, et n'en trouvent pas.
 *
 * Le seul effet de cet événement est d'inscrire la connexion au registre, et de
 * lui envoyer une première vue tout de suite — sans quoi la télé resterait
 * noire jusqu'au prochain changement, ce qui peut durer toute une phase de
 * révélation.
 *
 * Il est **rejouable** : un canal WebRTC se rompt souvent, et l'écran renvoie
 * sa demande à chaque réouverture. Se réinscrire ne consomme pas une place de
 * plus.
 */
const spectate: EventHandler = (ctx, payload) =>
  ctx.guard<null>(CLIENT_EVENTS.spectate, async () => {
    const { store, emitter, spectators } = ctx.deps;

    const parsed = spectateSchema.safeParse(payload);
    if (!parsed.success) return fail('INVALID_PAYLOAD');

    const game = await store.get(parsed.data.code);
    if (!game) return fail('GAME_NOT_FOUND');

    // Le plafond ne s'applique qu'à une **nouvelle** connexion : une reprise
    // après coupure ne doit pas se heurter à sa propre place, encore comptée
    // si l'ancienne fermeture n'est pas encore remontée.
    if (!spectators.has(ctx.connectionId) && spectators.isFull(game.code)) {
      return fail('SPECTATORS_FULL');
    }

    spectators.add(ctx.connectionId, game.code);
    sendSpectatorViews(emitter, spectators, game, Date.now(), ctx.connectionId);

    logger.debug(`Écran de suivi branché sur ${game.code} (${ctx.connectionId})`);
    return ok(null);
  });

export const spectateHandlers: Record<string, EventHandler> = {
  [CLIENT_EVENTS.spectate]: spectate,
};
