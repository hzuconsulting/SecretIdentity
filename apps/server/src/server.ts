import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server } from 'socket.io';
import {
  CLEANUP_INTERVAL_MS,
  GAME_TTL_MS,
  ICONS,
  IDENTITIES,
  type Rng,
} from '@identite-secrete/shared';
import { logger } from './logger';
import { TimerRegistry, timerKeys } from './game/timers';
import { InMemoryStore } from './store/InMemoryStore';
import type { GameStore } from './store/GameStore';
import { GameEngine } from './game/engine';
import { defaultHandlerConfig, registerGameHandlers } from './socket/handlers';

/**
 * Fabrique du serveur.
 *
 * Séparée du point d'entrée pour une raison précise : les tests d'intégration
 * démarrent un vrai serveur sur un port éphémère, avec de vrais clients
 * Socket.IO. Rien n'est simulé, seuls les délais sont raccourcis.
 */

export interface GameServerOptions {
  port?: number;
  clientOrigins?: string[];
  store?: GameStore;
  rng?: Rng;
  disconnectGraceMs?: number;
  hostTransferDelayMs?: number;
  rateLimitMaxEvents?: number;
  rateLimitWindowMs?: number;
  /** Facteur appliqué aux durées de phase. 1 en production. */
  timeScale?: number;
  /** `false` dans les tests : pas besoin d'une boucle de purge. */
  enableCleanup?: boolean;
}

export interface GameServer {
  io: Server;
  engine: GameEngine;
  httpServer: HttpServer;
  store: GameStore;
  timers: TimerRegistry;
  listen(): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const defaults = defaultHandlerConfig();
  const store = options.store ?? new InMemoryStore();
  const timers = new TimerRegistry();
  const rng = options.rng ?? defaults.rng;

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health' || req.url === '/') {
      void store.count().then((games) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            games,
            identities: IDENTITIES.length,
            icons: ICONS.length,
            uptimeSeconds: Math.round(process.uptime()),
          }),
        );
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  const io = new Server(httpServer, {
    cors: {
      origin: options.clientOrigins ?? ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 20_000,
    pingInterval: 10_000,
  });

  const engine = new GameEngine({
    io,
    store,
    timers,
    rng,
    timeScale: options.timeScale ?? 1,
  });

  io.on('connection', (socket) => {
    logger.debug(`Connexion ${socket.id}`);
    registerGameHandlers(socket, {
      io,
      store,
      timers,
      engine,
      rng,
      disconnectGraceMs: options.disconnectGraceMs ?? defaults.disconnectGraceMs,
      hostTransferDelayMs: options.hostTransferDelayMs ?? defaults.hostTransferDelayMs,
      rateLimitMaxEvents: options.rateLimitMaxEvents,
      rateLimitWindowMs: options.rateLimitWindowMs,
    });
  });

  let cleanupTimer: NodeJS.Timeout | null = null;

  if (options.enableCleanup !== false) {
    cleanupTimer = setInterval(() => {
      void store.purgeInactive(GAME_TTL_MS, Date.now()).then((codes) => {
        for (const code of codes) timers.cancelByPrefix(timerKeys.gamePrefix(code));
        if (codes.length > 0) logger.info(`Parties purgées : ${codes.join(', ')}`);
      });
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }

  return {
    io,
    engine,
    httpServer,
    store,
    timers,

    listen() {
      return new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(options.port ?? 0, () => {
          const address = httpServer.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('Adresse du serveur indisponible'));
            return;
          }
          resolve(address.port);
        });
      });
    },

    close() {
      return new Promise<void>((resolve) => {
        if (cleanupTimer) clearInterval(cleanupTimer);
        timers.clearAll();
        io.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
  };
}
