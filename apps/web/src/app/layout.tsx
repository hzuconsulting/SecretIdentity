import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Identité Secrète',
  description: 'Fais deviner ton personnage sans dire un mot. Jeu de soirée, 3 à 8 joueurs.',
  applicationName: 'Identité Secrète',
};

export const viewport: Viewport = {
  themeColor: '#F1ECFF',
  width: 'device-width',
  initialScale: 1,
  // Le zoom reste autorisé : le désactiver casse l'accessibilité.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
