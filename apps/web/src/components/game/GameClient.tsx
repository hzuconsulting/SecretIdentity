'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { GameError } from '@identite-secrete/shared';
import { useGameConnection } from '@/hooks/useGameConnection';
import { LobbyScreen } from '@/components/lobby/LobbyScreen';
import { FinalResultsScreen, ScoreboardScreen } from '@/components/game/RoundScreens';
import { GuessingScreen } from '@/components/game/GuessingScreen';
import { ResultsScreen } from '@/components/game/ResultsScreen';
import { ClueSelectionScreen } from '@/components/game/ClueSelectionScreen';
import { PausedOverlay } from '@/components/game/PausedOverlay';
import { IdentityRevealScreen } from '@/components/game/IdentityRevealScreen';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, ToastStack } from '@/components/ui/Feedback';
import { NicknameField } from '@/components/ui/NicknameField';

/**
 * Point d'entrée client d'une partie.
 *
 * Il détient la connexion et **route sur la phase envoyée par le moteur**.
 * Il n'existe aucune machine à états côté écran : `view.phase` décide, point.
 * C'est ce qui fait qu'actualiser la page ramène exactement au bon écran — y
 * compris chez l'hôte, dont le moteur est restauré depuis son stockage local.
 */
export function GameClient({ code }: { code: string }) {
  const {
    status,
    view,
    error,
    toasts,
    join,
    startGame,
    nextRound,
    submitClues,
    submitVotes,
    replay,
    updateSettings,
    kickPlayer,
    leave,
    dismissError,
    hosting,
  } = useGameConnection(code);

  const router = useRouter();

  const [nickname, setNickname] = useState('');
  const [joinError, setJoinError] = useState<GameError | null>(null);
  const [busy, setBusy] = useState(false);

  /** « Nouvelle partie » : on quitte le salon et on revient à l'accueil. */
  async function quitToHome() {
    await leave();
    router.push('/');
  }

  async function submitNickname() {
    if (busy || nickname.trim().length === 0) return;

    setBusy(true);
    setJoinError(null);

    const failure = await join(nickname.trim());
    if (failure) {
      setJoinError(failure);
      if (failure.suggestion) setNickname(failure.suggestion);
    }
    setBusy(false);
  }

  // L'exclusion passe avant tout le reste : elle est définitive, et l'écran ne
  // doit surtout pas proposer de retenter sa chance.
  if (status === 'kicked') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10 text-center">
        <p className="text-5xl" aria-hidden="true">
          🚪
        </p>
        <h1 className="font-display text-3xl font-black uppercase leading-none">
          Tu as été exclu·e
        </h1>
        <p className="text-base font-semibold text-muted">
          L’hôte t’a sorti·e de la partie {code}. Tu peux créer ta propre partie ou en
          rejoindre une autre.
        </p>
        <Link
          href="/"
          className="mx-auto min-h-[48px] rounded-tile bg-violet px-6 py-3 font-display text-base font-extrabold uppercase tracking-wide text-white shadow-tile"
        >
          Retour à l’accueil
        </Link>
      </main>
    );
  }

  if (status === 'need-nickname' || status === 'joining') {
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
            Partie <strong className="tracking-widest text-ink">{code}</strong>. Choisis
            ton pseudo pour entrer dans le salon.
          </p>
        </div>

        <NicknameField value={nickname} onChange={setNickname} autoFocus />
        <ErrorBanner error={joinError} onDismiss={() => setJoinError(null)} />

        <Button
          onClick={() => void submitNickname()}
          disabled={busy || nickname.trim().length === 0}
        >
          {busy ? 'Connexion…' : 'Entrer dans le salon'}
        </Button>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10 text-center">
        <p className="font-display text-2xl font-black uppercase">
          {status === 'host-gone'
            ? 'Partie fermée'
            : status === 'lost'
              ? 'Connexion perdue'
              : 'Connexion au salon…'}
        </p>
        <p className="text-base font-semibold text-muted">
          {status === 'host-gone'
            ? 'L’hôte a fermé son onglet : c’est son téléphone qui faisait tourner la partie. Il faut en créer une nouvelle.'
            : status === 'lost'
              ? 'L’hôte ne répond pas. La reconnexion est automatique dès qu’il revient.'
              : 'Encore une seconde.'}
        </p>
        <ErrorBanner error={error} onDismiss={dismissError} />
        <Link
          href="/"
          className="font-display text-sm font-extrabold uppercase tracking-widest text-violet"
        >
          Retour à l’accueil
        </Link>
      </main>
    );
  }

  return (
    <>
      {renderPhase()}
      {view.paused ? <PausedOverlay view={view} /> : null}
      {hosting ? <HostingNotice /> : null}
      <ToastStack toasts={toasts} />
    </>
  );

  function renderPhase() {
    if (!view) return null;

    switch (view.phase) {
      case 'LOBBY':
        return (
          <LobbyScreen
            view={view}
            connectionLost={status === 'lost'}
            error={error}
            onDismissError={dismissError}
            onUpdateSettings={updateSettings}
            onStart={startGame}
            onLeave={leave}
            onKick={kickPlayer}
          />
        );

      case 'IDENTITY_REVEAL':
        return <IdentityRevealScreen view={view} />;

      case 'CLUE_SELECTION':
        return (
          <ClueSelectionScreen view={view} onSubmit={submitClues} onKick={kickPlayer} />
        );

      case 'GUESSING':
        return <GuessingScreen view={view} onSubmit={submitVotes} onKick={kickPlayer} />;

      case 'RESULTS':
        return <ResultsScreen view={view} />;

      case 'SCOREBOARD':
        return <ScoreboardScreen view={view} onNextRound={nextRound} />;

      case 'FINAL_RESULTS':
        return <FinalResultsScreen view={view} onReplay={replay} onLeave={quitToHome} />;

      default:
        return null;
    }
  }
}

/**
 * Rappel discret, affiché uniquement chez l'hôte.
 *
 * Son onglet **est** le serveur : le fermer met fin à la partie pour tout le
 * monde. C'est la contrepartie de « aucun serveur à déployer », et elle mérite
 * d'être dite une fois, sans bloquer l'écran. Un rafraîchissement, lui, est sans
 * danger : la partie est restaurée depuis le stockage local.
 */
function HostingNotice() {
  return (
    <p className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-[11px] font-semibold text-muted">
      La partie tourne sur ton téléphone · garde cet onglet ouvert
    </p>
  );
}
