import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { isValidGameCode, normalizeGameCode } from '@identite-secrete/shared';
import { GameClient } from '@/components/game/GameClient';

export const metadata: Metadata = {
  title: 'Partie · Identité Secrète',
};

interface PageProps {
  params: Promise<{ code: string }>;
}

/**
 * `/game/K7P4Q` — la cible des liens partagés.
 *
 * Le code est normalisé ici : un lien copié en minuscules doit fonctionner.
 * Un code manifestement invalide renvoie au formulaire plutôt que d'afficher
 * un salon vide qui ne se remplira jamais.
 */
export default async function GamePage({ params }: PageProps) {
  const { code: raw } = await params;
  const code = normalizeGameCode(decodeURIComponent(raw));

  if (!isValidGameCode(code)) redirect('/rejoindre');

  return <GameClient code={code} />;
}
