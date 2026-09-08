'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import {
  CLIENT_EVENTS,
  MIN_PLAYERS,
  type GameError,
  type SessionPayload,
} from '@identite-secrete/shared';
import { emitWithAck, getSocket } from '@/lib/socket';
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

  async function create() {
    // Le bouton est désactivé pendant l'aller-retour : un double clic ne peut
    // pas créer deux parties.
    if (busy) return;

    setBusy(true);
    setError(null);

    const response = await emitWithAck<SessionPayload>(
      getSocket(),
      CLIENT_EVENTS.createGame,
      { nickname: nickname.trim() },
    );

    if (!response.ok) {
      setError(response.error);
      setBusy(false);
      return;
    }

    saveSession(response.data);
    router.push(`/game?${CODE_PARAM}=${response.data.code}`);
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
          {MIN_PLAYERS} joueurs pour lancer.
        </p>
      </div>

      <NicknameField value={nickname} onChange={setNickname} autoFocus />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Button
        onClick={() => void create()}
        disabled={busy || nickname.trim().length === 0}
      >
        {busy ? 'Création…' : 'Créer la partie'}
      </Button>
    </main>
  );
}
