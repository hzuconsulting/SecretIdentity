'use client';

import { useCallback, useEffect, useState } from 'react';

interface IdentityCardProps {
  identityName: string;
  compact?: boolean;
}

/**
 * La carte qui porte l'identité secrète, avec son masquage d'écran (§7.2).
 *
 * Une fois masquée, le nom ne réapparaît que **tant que** le bouton est
 * maintenu. Il se recache au relâchement, à la sortie du doigt, à la perte de
 * focus, et quand l'onglet passe en arrière-plan — ce dernier cas compte : on
 * ne veut pas qu'un nom réapparaisse dans l'aperçu multitâche du téléphone.
 *
 * Équivalent clavier : maintien de la barre d'espace, bouton focalisé.
 */
export function IdentityCard({ identityName, compact = false }: IdentityCardProps) {
  const [masked, setMasked] = useState(false);
  const [peeking, setPeeking] = useState(false);

  const stopPeeking = useCallback(() => setPeeking(false), []);

  useEffect(() => {
    if (!peeking) return;

    const onHidden = () => {
      if (document.visibilityState === 'hidden') stopPeeking();
    };

    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', stopPeeking);

    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', stopPeeking);
    };
  }, [peeking, stopPeeking]);

  const visible = !masked || peeking;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={[
          'w-full rounded-card bg-ink text-center shadow-card',
          compact ? 'px-5 py-4' : 'px-6 py-9',
        ].join(' ')}
      >
        <p className="font-display text-[0.7rem] font-extrabold uppercase tracking-[0.22em] text-sun">
          Ton identité
        </p>

        {visible ? (
          <p
            className={[
              'mt-2 break-words font-display font-black text-white',
              compact ? 'text-2xl' : 'text-4xl leading-tight',
            ].join(' ')}
          >
            {identityName}
          </p>
        ) : (
          <p
            className={[
              'mt-2 font-display font-black uppercase tracking-widest text-white/35',
              compact ? 'text-xl' : 'text-3xl',
            ].join(' ')}
          >
            Identité masquée
          </p>
        )}
      </div>

      {masked ? (
        <button
          type="button"
          onPointerDown={() => setPeeking(true)}
          onPointerUp={stopPeeking}
          onPointerLeave={stopPeeking}
          onPointerCancel={stopPeeking}
          onBlur={stopPeeking}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Spacebar') {
              event.preventDefault();
              setPeeking(true);
            }
          }}
          onKeyUp={(event) => {
            if (event.key === ' ' || event.key === 'Spacebar') stopPeeking();
          }}
          className="min-h-[48px] rounded-tile bg-white px-5 font-display text-sm font-extrabold uppercase tracking-wide shadow-tile active:translate-y-1 active:shadow-tile-active"
        >
          Maintenir pour voir
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setMasked(true)}
          className="min-h-[44px] font-display text-xs font-extrabold uppercase tracking-widest text-muted"
        >
          👁 Masquer mon identité
        </button>
      )}
    </div>
  );
}
