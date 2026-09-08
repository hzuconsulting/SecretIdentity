import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      // Le format de fil vit côté client mais reste de la logique pure : il se
      // teste sans navigateur, et il vaut mieux qu'il le soit — c'est lui qui
      // décide de ce qui traverse un canal WebRTC.
      'apps/web/src/**/*.test.ts',
    ],
    reporters: ['default'],
    // Les tests d'intégration jouent de vraies parties sur de vrais minuteurs :
    // les 5 s par défaut de Vitest ne suffisent pas à une partie de 2 manches.
    testTimeout: 25_000,
    hookTimeout: 15_000,
  },
});
