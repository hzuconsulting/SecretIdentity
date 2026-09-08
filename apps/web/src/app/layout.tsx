import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BASE_PATH } from '@/lib/config';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import './globals.css';

const DESCRIPTION =
  'Fais deviner ton personnage sans dire un mot. Jeu de soirée, 3 à 8 joueurs.';

export const metadata: Metadata = {
  title: 'Identité Secrète',
  description: DESCRIPTION,
  applicationName: 'Identité Secrète',
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${BASE_PATH}/icons/favicon-64.png`, sizes: '64x64', type: 'image/png' },
      { url: `${BASE_PATH}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
    ],
    apple: `${BASE_PATH}/icons/apple-touch-icon.png`,
  },
  // iOS ne lit pas le manifeste : ces valeurs sont ce qui lui fait ouvrir le
  // site en plein écran, sans barre d'adresse, une fois ajouté à l'accueil.
  appleWebApp: {
    capable: true,
    title: 'Identité',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'Identité Secrète',
    description: DESCRIPTION,
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#5B3DF5',
  width: 'device-width',
  initialScale: 1,
  // Le zoom reste autorisé : le désactiver casse l'accessibilité.
  maximumScale: 5,
  // Nécessaire en mode application : sans lui, le contenu s'arrête au-dessus
  // de l'encoche et de la barre de geste au lieu d'occuper l'écran.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
