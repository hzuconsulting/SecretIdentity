'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { MIN_PLAYERS, gameError, type GameError } from '@identite-secrete/shared';
import { createHostedGame } from '@/lib/net';
import { saveSession } from '@/lib/session';
import { CODE_PARAM } from '@/components/game/GameRoute';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { NicknameField } from '@/components/ui/NicknameField';

export default function CreateGamePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<GameError | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Crée la partie **dans cet onglet**.
   *
   * C'est ici que le téléphone de l'hôte devient le moteur : il réserve un code
   * auprès du service de mise en relation, puis fait tourner la partie jusqu'à
   * la fin. Tant que cet onglet reste ouvert, la partie vit.
   */
  async function create() {
    // Le bouton est désactivé pendant l'opération : un double clic ne peut pas
    // créer deux parties.
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const session = await createHostedGame(nickname.trim());
      saveSession(session);
      router.push(`/game?${CODE_PARAM}=${session.code}`);
    } catch (cause) {
      setError(
        gameError('INTERNAL_ERROR', {
          message:
            cause instanceof Error && cause.message
              ? cause.message
              : 'Impossible d’ouvrir la partie. Vérifie ta connexion et réessaie.',
        }),
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10">
      <div>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-display text-sm font-extrabold uppercase tracking-widest text-violet"
        >
          ← Accueil
        </Link>
        <h1 className="mt-2 font-display text-4xl font-black uppercase leading-none tracking-tight">
          Créer une partie
        </h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Tu seras l’hôte. Tu recevras un code à envoyer à tes amis — il faut au moins{' '}
          {MIN_PLAYERS} joueurs pour lancer. <strong className="text-ink">Garde cet onglet
          ouvert</strong> : la partie tourne sur ton téléphone.
        </p>
      </div>

      <NicknameField value={nickname} onChange={setNickname} autoFocus />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Button
        onClick={() => void create()}
        disabled={busy || nickname.trim().length === 0}
      >
        {busy ? 'Ouverture du salon…' : 'Créer la partie'}
      </Button>
    </main>
  );
}
