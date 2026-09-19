'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { CODE_LENGTH, isValidGameCode, normalizeGameCode } from '@identite-secrete/shared';
import { TvScreen } from './TvScreen';
import { TV_CODE_PARAM, tvPath } from './tvLink';

/**
 * `/tv` — l'écran de suivi.
 *
 * Avec un code (`/tv?c=K7P4Q`), il affiche la partie. Sans code, il demande le
 * code plutôt que de renvoyer vers `/rejoindre` : ce n'est pas le même geste.
 * Quelqu'un qui arrive ici veut **regarder**, et l'envoyer sur un formulaire
 * qui réclame un pseudo et le ferait entrer dans le salon serait exactement
 * l'inverse de ce qu'il demande.
 *
 * Le formulaire est dessiné comme l'écran qu'il précède — sombre, en grand :
 * on le remplit souvent avec une télécommande, au clavier virtuel d'une télé.
 */
export function TvRoute() {
  const params = useSearchParams();
  const code = normalizeGameCode(params.get(TV_CODE_PARAM) ?? '');

  if (!isValidGameCode(code)) return <TvCodeForm />;

  return <TvScreen code={code} />;
}

function TvCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const ready = isValidGameCode(code);

  function open() {
    if (ready) router.push(tvPath(code));
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-ink px-6 text-center text-white">
      <p className="tv-hero" aria-hidden="true">
        📺
      </p>

      <h1 className="tv-title font-display font-black uppercase">Écran de suivi</h1>
      <p className="tv-body max-w-[44ch] font-semibold text-white/60">
        Le score, le temps restant et les personnages de la partie, en grand — pour ceux qui
        regardent sans jouer. Entre le code de la partie.
      </p>

      <form
        className="flex w-full max-w-md flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          open();
        }}
      >
        <label htmlFor="tv-code" className="sr-only">
          Code de la partie
        </label>
        <input
          id="tv-code"
          name="code"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          maxLength={CODE_LENGTH + 2}
          value={code}
          placeholder="K7P4Q"
          onChange={(event) => setCode(normalizeGameCode(event.target.value))}
          className="tv-hero min-h-[1.6em] w-full rounded-tile bg-white/10 px-4 py-2 text-center font-display font-black uppercase tracking-[0.2em] ring-1 ring-white/20 placeholder:text-white/20"
        />

        <button
          type="submit"
          disabled={!ready}
          className="tv-value min-h-[56px] w-full rounded-tile bg-violet px-6 font-display font-extrabold uppercase tracking-wide text-white disabled:opacity-40"
        >
          Suivre la partie
        </button>
      </form>

      <Link
        href="/"
        className="tv-body font-display font-extrabold uppercase tracking-widest text-white/50 underline underline-offset-4"
      >
        Retour à l’accueil
      </Link>
    </main>
  );
}
