import { z } from 'zod';

/**
 * Lecture et validation de l'environnement au démarrage.
 * On échoue tout de suite et bruyamment plutôt qu'à la première connexion.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environnement invalide :', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  port: raw.PORT,
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  /** `CLIENT_ORIGIN` accepte plusieurs origines séparées par des virgules. */
  clientOrigins: raw.CLIENT_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;
