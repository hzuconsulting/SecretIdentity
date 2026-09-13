'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { avatarColor, avatarInitial } from '@identite-secrete/shared';
import { DIRECTORY_URL } from '@/lib/config';
import {
  POLL_INTERVAL_MS,
  aggregateDirectory,
  estimateServerNow,
  fetchDirectoryRecords,
  isFull,
  type OpenGame,
} from '@/lib/net/directory';

/**
 * Paramètre de code de la page de partie.
 *
 * Le même que `CODE_PARAM` (`components/game/GameRoute.tsx`), recopié plutôt
 * qu'importé : l'importer embarquerait tout le client de jeu dans l'accueil.
 */
const CODE_PARAM = 'c';

/** Recul maximal entre deux relectures après des échecs répétés. */
const MAX_BACKOFF_MS = 60_000;

/**
 * Échecs consécutifs avant d'annoncer l'annuaire indisponible.
 *
 * Une relecture manquée ne doit pas faire disparaître la liste : le réseau
 * mobile a ses hoquets, et la suivante a toutes les chances de passer.
 */
const FAILURES_BEFORE_UNAVAILABLE = 2;

type DirectoryState =
  | { phase: 'loading' }
  | { phase: 'ready'; games: OpenGame[] }
  | { phase: 'unavailable' };

/**
 * Les parties publiques ouvertes, pour entrer d'un toucher.
 *
 * C'est un raccourci, pas un passage obligé : l'annuaire vit sur un service
 * public que rien ne garantit, donc tout ce qui s'affiche ici reste discret
 * quand il se tait — le code, lui, marche toujours.
 *
 * On ne relit que tant que la page est à l'écran : un onglet oublié en
 * arrière-plan n'a aucune raison de consommer le quota de requêtes du réseau,
 * qu'il partage avec les autres téléphones du salon.
 */
export function OpenGames() {
  const [state, setState] = useState<DirectoryState>({ phase: 'loading' });

  useEffect(() => {
    const url = DIRECTORY_URL;
    if (!url) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let failures = 0;

    const visible = () => document.visibilityState === 'visible';

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = (ms: number) => {
      clearTimer();
      if (!cancelled && visible()) timer = setTimeout(() => void poll(), ms);
    };

    const poll = async () => {
      clearTimer();
      if (cancelled || !visible()) return;

      controller?.abort();
      const current = new AbortController();
      controller = current;

      try {
        const records = await fetchDirectoryRecords(url, { signal: current.signal });
        if (cancelled || current.signal.aborted) return;

        failures = 0;
        const now = estimateServerNow(records, Date.now());
        setState({ phase: 'ready', games: aggregateDirectory(records, now) });
        schedule(POLL_INTERVAL_MS);
      } catch (cause) {
        if (cancelled || current.signal.aborted) return;

        failures++;
        console.debug('[annuaire] relecture impossible', cause);
        setState((previous) =>
          previous.phase === 'ready' && failures < FAILURES_BEFORE_UNAVAILABLE
            ? previous
            : { phase: 'unavailable' },
        );
        schedule(Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS));
      }
    };

    const onVisibility = () => {
      if (visible()) {
        void poll();
      } else {
        clearTimer();
        controller?.abort();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    void poll();

    return () => {
      cancelled = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!DIRECTORY_URL) return null;

  return (
    <section aria-labelledby="open-games-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2
          id="open-games-title"
          className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
        >
          Parties ouvertes
        </h2>
        {state.phase === 'ready' && state.games.length > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-mint" aria-hidden="true" />
            En direct
          </span>
        ) : null}
      </div>

      <div aria-live="polite" aria-busy={state.phase === 'loading'}>
        {state.phase === 'loading' ? (
          <Notice>Recherche des parties publiques…</Notice>
        ) : state.phase === 'unavailable' ? (
          <Notice>
            Liste des parties indisponible pour le moment. Avec un code, on entre toujours.
          </Notice>
        ) : state.games.length === 0 ? (
          <Notice>Aucune partie publique en ce moment. Crée la tienne&nbsp;!</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {state.games.map((game) => (
              <li key={game.code}>
                <OpenGameRow game={game} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-tile bg-white/60 px-4 py-3 text-center text-sm text-muted">{children}</p>
  );
}

const ROW =
  'flex min-h-[64px] w-full items-center gap-3 rounded-tile bg-white px-4 py-3 text-left shadow-tile';

function OpenGameRow({ game }: { game: OpenGame }) {
  const full = isFull(game);
  const playing = game.status === 'playing';

  const content = (
    <>
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-lg font-black text-white"
        style={{ backgroundColor: avatarColor(game.code) }}
        aria-hidden="true"
      >
        {avatarInitial(game.host)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-base font-extrabold text-ink">
          Partie de {game.host}
        </span>
        <span className="block text-sm leading-snug text-muted">
          {game.players}/{game.max} joueurs · {describeStatus(game)}
        </span>
      </span>

      <span
        className={[
          'shrink-0 rounded-full px-3 py-1.5 font-display text-xs font-extrabold uppercase tracking-wide',
          full ? 'bg-lilac text-muted' : playing ? 'bg-violet-light text-violet-dark' : 'bg-violet text-white',
        ].join(' ')}
      >
        {full ? 'Complet' : playing ? 'Revenir' : 'Rejoindre'}
      </span>
    </>
  );

  // Un salon plein ne mène nulle part : on le montre, sans en faire un lien.
  if (full) return <div className={`${ROW} opacity-70`}>{content}</div>;

  return (
    <Link
      href={`/game?${CODE_PARAM}=${game.code}`}
      className={`${ROW} transition-[transform,background-color,box-shadow] duration-150 hover:bg-violet-light active:translate-y-1 active:shadow-tile-active`}
    >
      {content}
    </Link>
  );
}

function describeStatus(game: OpenGame): string {
  // Un salon plein le dit déjà sur sa pastille « Complet ».
  if (game.status === 'lobby') return 'Au salon';
  return game.round > 0 ? `En cours · manche ${game.round}/${game.rounds}` : 'En cours';
}
