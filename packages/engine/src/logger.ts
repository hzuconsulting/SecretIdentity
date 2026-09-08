/**
 * Journalisation.
 *
 * Le moteur tourne désormais dans un navigateur : il n'y a plus de `process.env`
 * à lire au démarrage. Le niveau est donc réglé par l'appelant — le nœud hôte le
 * met à `warn` en production, les tests à `error` pour ne pas noyer Vitest.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

let minLevel: LogLevel = 'warn';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function emit(level: Exclude<LogLevel, 'silent'>, message: string, details?: unknown): void {
  if (ORDER[level] < ORDER[minLevel]) return;

  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const target =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;

  if (details === undefined) target(line);
  else target(line, details);
}

export const logger = {
  debug: (message: string, details?: unknown) => emit('debug', message, details),
  info: (message: string, details?: unknown) => emit('info', message, details),
  warn: (message: string, details?: unknown) => emit('warn', message, details),
  error: (message: string, details?: unknown) => emit('error', message, details),
};
