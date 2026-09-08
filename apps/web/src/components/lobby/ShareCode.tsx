'use client';

import { useState } from 'react';
import { BASE_PATH } from '@/lib/config';
import { CODE_PARAM } from '@/components/game/GameRoute';
import { Button } from '@/components/ui/Button';

interface ShareCodeProps {
  code: string;
}

type Feedback = 'idle' | 'copied' | 'failed';

/**
 * Le code de partie, lettre par lettre.
 *
 * Il est fait pour être lu à voix haute dans une pièce bruyante : d'où
 * l'espacement entre les caractères, la taille, et l'alphabet sans 0/O ni 1/I
 * du générateur de codes.
 */
export function ShareCode({ code }: ShareCodeProps) {
  const [feedback, setFeedback] = useState<Feedback>('idle');

  // `window.location.origin` ne contient pas le préfixe du site : sur GitHub
  // Pages, il faut l'ajouter, sinon le lien partagé tombe à côté.
  const gameUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${BASE_PATH}/game?${CODE_PARAM}=${code}`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setFeedback('copied');
      setTimeout(() => setFeedback('idle'), 2_000);
    } catch {
      setFeedback('failed');
    }
  }

  async function share() {
    const payload = {
      title: 'Identité Secrète',
      text: `Rejoins ma partie avec le code ${code}`,
      url: gameUrl,
    };

    // Web Share API sur mobile, repli sur le presse-papier ailleurs.
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // Partage annulé par l'utilisateur ou refusé : on tente le repli.
      }
    }

    try {
      await navigator.clipboard.writeText(gameUrl);
      setFeedback('copied');
      setTimeout(() => setFeedback('idle'), 2_000);
    } catch {
      setFeedback('failed');
    }
  }

  return (
    <section className="rounded-card bg-white p-6 text-center shadow-card">
      <h2 className="font-display text-xs font-extrabold uppercase tracking-widest text-muted">
        Code de la partie
      </h2>

      <p className="mt-3 flex justify-center gap-1.5" aria-label={`Code ${code.split('').join(' ')}`}>
        {code.split('').map((char, index) => (
          <span
            key={`${char}-${index}`}
            className="flex h-14 w-11 items-center justify-center rounded-tile bg-ink font-display text-3xl font-black text-white"
            aria-hidden="true"
          >
            {char}
          </span>
        ))}
      </p>

      <div className="mt-5 flex gap-2">
        <Button variant="soft" size="md" onClick={() => void copyCode()}>
          Copier le code
        </Button>
        <Button variant="accent" size="md" onClick={() => void share()}>
          Partager
        </Button>
      </div>

      <p className="mt-3 min-h-[1.25rem] text-sm font-semibold text-muted" aria-live="polite">
        {feedback === 'copied'
          ? 'Copié !'
          : feedback === 'failed'
            ? `Copie impossible. Le lien est : ${gameUrl}`
            : 'Ou envoie le lien directement.'}
      </p>
    </section>
  );
}
