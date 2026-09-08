'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  MIN_PLAYERS,
  type GameError,
  type PlayerView,
  type Settings,
} from '@identite-secrete/shared';
import { PlayerList } from '@/components/lobby/PlayerList';
import { SettingsPanel } from '@/components/lobby/SettingsPanel';
import { ShareCode } from '@/components/lobby/ShareCode';
import { useSound } from '@/hooks/useSound';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { SoundToggle } from '@/components/ui/SoundToggle';

interface LobbyScreenProps {
  view: PlayerView;
  connectionLost: boolean;
  error: GameError | null;
  onDismissError: () => void;
  onUpdateSettings: (patch: Partial<Settings>) => Promise<GameError | null>;
  onStart: () => Promise<GameError | null>;
  onLeave: () => Promise<void>;
}

/**
 * Le salon.
 *
 * Composant purement présentatif : il reçoit la vue et les actions, il ne
 * connaît ni la socket ni le stockage de session. C'est ce qui permet de
 * l'échanger avec un écran de manche sans rien démonter.
 */
export function LobbyScreen({
  view,
  connectionLost,
  error,
  onDismissError,
  onUpdateSettings,
  onStart,
  onLeave,
}: LobbyScreenProps) {
  const router = useRouter();
  const { play } = useSound();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<GameError | null>(null);

  // Son à chaque arrivée — pas au départ : on ne sonne pas la mauvaise nouvelle.
  const previousCount = useRef(view.players.length);
  useEffect(() => {
    if (view.players.length > previousCount.current) play('join');
    previousCount.current = view.players.length;
  }, [view.players.length, play]);

  const connectedCount = view.players.filter((player) => player.connected).length;
  const missing = MIN_PLAYERS - connectedCount;
  const enoughPlayers = missing <= 0;

  async function start() {
    if (starting) return;
    setStarting(true);
    setStartError(null);

    const failure = await onStart();
    if (failure) setStartError(failure);
    setStarting(false);
  }

  async function quit() {
    await onLeave();
    router.push('/');
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-black uppercase leading-none tracking-tight">
          Salon
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/comment-jouer"
            className="font-display text-xs font-extrabold uppercase tracking-widest text-violet"
          >
            Règles
          </Link>
          <button
            type="button"
            onClick={() => void quit()}
            className="min-h-[44px] font-display text-xs font-extrabold uppercase tracking-widest text-muted"
          >
            Quitter
          </button>
          <SoundToggle />
        </div>
      </header>

      <ShareCode code={view.code} />

      {connectionLost ? (
        <p
          role="status"
          className="rounded-tile bg-sun-light px-4 py-3 text-sm font-semibold text-ink"
        >
          Connexion interrompue. Ta place est gardée, la reconnexion est automatique.
        </p>
      ) : null}

      <ErrorBanner error={error} onDismiss={onDismissError} />

      <PlayerList players={view.players} youId={view.you.id} />

      <SettingsPanel
        settings={view.settings}
        canEdit={view.you.isHost}
        onChange={onUpdateSettings}
      />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <ErrorBanner error={startError} onDismiss={() => setStartError(null)} />

        {view.you.isHost ? (
          <Button onClick={() => void start()} disabled={starting || !enoughPlayers}>
            {starting ? 'Lancement…' : 'Lancer la partie'}
          </Button>
        ) : null}

        <p className="text-center text-sm font-semibold text-muted" aria-live="polite">
          {enoughPlayers
            ? view.you.isHost
              ? `${view.settings.rounds} manches, c'est parti quand tu veux.`
              : 'On attend que l’hôte lance la partie.'
            : `Encore ${missing} joueur${missing > 1 ? 's' : ''} avant de pouvoir lancer.`}
        </p>
      </div>
    </main>
  );
}
