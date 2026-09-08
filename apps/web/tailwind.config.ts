import type { Config } from 'tailwindcss';

/**
 * Direction artistique : jeu de société moderne.
 * Fond lilas très clair, cartes blanches à grand rayon, ombres teintées violet
 * (jamais du gris neutre : une ombre grise fait « dashboard »).
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B1338',
        muted: '#6B6191',
        violet: {
          DEFAULT: '#5B3DF5',
          dark: '#4326D6',
          light: '#EDE8FF',
        },
        pink: {
          DEFAULT: '#FF3D8B',
          light: '#FFE4EE',
        },
        mint: {
          DEFAULT: '#12B886',
          light: '#DDF6EC',
        },
        sun: {
          DEFAULT: '#FFC53D',
          light: '#FFF3D6',
        },
        lilac: '#F1ECFF',
      },
      fontFamily: {
        // Aucune police distante : rendu immédiat, zéro dépendance réseau.
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      borderRadius: {
        card: '1.75rem',
        tile: '1.25rem',
      },
      boxShadow: {
        card: '0 18px 40px -20px rgba(48, 20, 130, 0.35)',
        tile: '0 6px 0 0 rgba(27, 19, 56, 0.12)',
        'tile-active': '0 2px 0 0 rgba(27, 19, 56, 0.12)',
      },
      keyframes: {
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'float-slow': 'float-slow 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
