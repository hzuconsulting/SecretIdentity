import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/server/src/**/*.test.ts',
    ],
    reporters: ['default'],
    // Les tests d'intégration jouent de vraies parties sur de vrais minuteurs :
    // les 5 s par défaut de Vitest ne suffisent pas à une partie de 2 manches.
    testTimeout: 25_000,
    hookTimeout: 15_000,
  },
});
