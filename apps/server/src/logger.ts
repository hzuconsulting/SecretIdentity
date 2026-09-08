import { env } from './config/env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// En test, seules les vraies erreurs remontent : sinon la sortie de Vitest est
// noyée sous les logs de connexion des dizaines de sockets.
const MIN_LEVEL: Level =
  env.nodeEnv === 'test' ? 'error' : env.isProduction ? 'info' : 'debug';

function emit(level: Level, message: string, details?: unknown): void {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;

  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (details === undefined) target(line);
  else target(line, details);
}

export const logger = {
  debug: (message: string, details?: unknown) => emit('debug', message, details),
  info: (message: string, details?: unknown) => emit('info', message, details),
  warn: (message: string, details?: unknown) => emit('warn', message, details),
  error: (message: string, details?: unknown) => emit('error', message, details),
};
