import { ICONS, IDENTITIES } from '@identite-secrete/shared';
import { env } from './config/env';
import { logger } from './logger';
import { createGameServer } from './server';

/**
 * Point d'entrée.
 *
 * Toute la construction vit dans `server.ts` : ici on ne fait que lire
 * l'environnement, écouter, et s'arrêter proprement.
 */
const server = createGameServer({
  port: env.port,
  clientOrigins: env.clientOrigins,
});

void server.listen().then((port) => {
  logger.info(`Serveur Identité Secrète sur le port ${port}`);
  logger.info(`Origines autorisées : ${env.clientOrigins.join(', ')}`);
  logger.info(`Catalogue : ${IDENTITIES.length} identités, ${ICONS.length} icônes`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} reçu, arrêt en cours…`);
  void server.close().then(() => process.exit(0));
  // Filet de sécurité si une socket refuse de se fermer.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
