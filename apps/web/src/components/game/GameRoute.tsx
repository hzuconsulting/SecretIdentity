'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { isValidGameCode, normalizeGameCode } from '@identite-secrete/shared';
import { GameClient } from '@/components/game/GameClient';

/** Nom du paramètre portant le code de partie. Court : il finit dans un SMS. */
export const CODE_PARAM = 'c';

/**
 * Lit le code de partie dans l'URL et monte la partie.
 *
 * Un code absent ou mal formé renvoie au formulaire plutôt que d'afficher un
 * salon vide qui ne se remplira jamais. La redirection passe par un effet :
 * rediriger pendant le rendu déclencherait un avertissement React.
 */
export function GameRoute() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get(CODE_PARAM) ?? '';
  const code = normalizeGameCode(raw);
  const valid = isValidGameCode(code);

  useEffect(() => {
    if (!valid) router.replace('/rejoindre');
  }, [valid, router]);

  if (!valid) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-5 text-center">
        <p className="font-display text-lg font-extrabold uppercase tracking-widest text-muted">
          Code de partie manquant…
        </p>
      </main>
    );
  }

  return <GameClient code={code} />;
}
