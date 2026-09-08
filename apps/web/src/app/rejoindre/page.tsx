'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CLIENT_EVENTS,
  CODE_LENGTH,
  gameError,
  isValidGameCode,
  normalizeGameCode,
  type GameError,
  type SessionPayload,
} from '@identite-secrete/shared';
import { getNode } from '@/lib/net';
import { saveSession } from '@/lib/session';
import { CODE_PARAM } from '@/components/game/GameRoute';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { NicknameField } from '@/components/ui/NicknameField';

export default function JoinGamePage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<GameError | null>(null);
  const [busy, setBusy] = useState(false);

  const codeReady = isValidGameCode(code);
  const ready = codeReady && nickname.trim().length > 0;

  async function join() {
    if (busy || !ready) return;

    setBusy(true);
    setError(null);

    const normalized = normalizeGameCode(code);

    // Ouvrir le canal, c'est déjà chercher la partie : le code est
    // l'identifiant de l'hôte auprès du service de mise en relation. Un code
    // inconnu échoue ici, avant même qu'on parle de pseudo.
    let node;
    try {
      node = await getNode(normalized);
    } catch {
      setError(
        gameError('GAME_NOT_FOUND', {
          message:
            'Aucune partie ouverte sous ce code. Vérifie-le, et que l’hôte a bien gardé son onglet ouvert.',
        }),
      );
      setBusy(false);
      return;
    }

    const response = await node.emit<SessionPayload>(CLIENT_EVENTS.joinGame, {
      code: normalized,
      nickname: nickname.trim(),
    });

    if (!response.ok) {
      setError(response.error);
      // Une suggestion de pseudo est directement applicable : on la pré-remplit.
      if (response.error.suggestion) setNickname(response.error.suggestion);
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
          Rejoindre
        </h1>
        <p className="mt-2 text-base font-semibold text-muted">
          Entre le code que l’hôte t’a envoyé.
        </p>
      </div>

      <div>
        <label
          htmlFor="code"
          className="mb-2 block font-display text-xs font-extrabold uppercase tracking-widest text-muted"
        >
          Code de la partie
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={CODE_LENGTH + 2}
          value={code}
          placeholder="K7P4Q"
          onChange={(event) => setCode(normalizeGameCode(event.target.value))}
          className="min-h-[64px] w-full rounded-tile bg-white px-4 text-center font-display text-4xl font-black uppercase tracking-[0.3em] shadow-tile placeholder:tracking-[0.3em] placeholder:text-muted/40"
        />
        <p className="mt-1.5 text-xs text-muted">
          {CODE_LENGTH} caractères. Les lettres O et I ne sont jamais utilisées.
        </p>
      </div>

      <NicknameField value={nickname} onChange={setNickname} />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <Button onClick={() => void join()} disabled={busy || !ready}>
        {busy ? 'Connexion…' : 'Rejoindre la partie'}
      </Button>
    </main>
  );
}
