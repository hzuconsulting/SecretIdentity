'use client';

import { useCallback, useEffect, useState } from 'react';
import { Portrait } from './Portrait';

interface IdentityCardProps {
  identityName: string;
  /** Le personnage, pour son portrait. Masqué en même temps que le nom. */
  identityId?: string | null;
  /** Le numéro de la carte Mystère. Masqué en même temps que le nom. */
  slot?: number | null;
  compact?: boolean;
}

/** Portrait de la carte : 96 px, 56 en version compacte (au-dessus du boîtier). */
const PORTRAIT_PX = { full: 96, compact: 56 } as const;

/**
 * La carte qui porte l'identité secrète, avec son masquage d'écran (§7.2).
 *
 * Une fois masquée, le nom — et le portrait, qui trahirait le personnage aussi
 * sûrement — ne réapparaît que **tant que** le bouton est
 * maintenu. Il se recache au relâchement, à la sortie du doigt, à la perte de
 * focus, et quand l'onglet passe en arrière-plan — ce dernier cas compte : on
 * ne veut pas qu'un nom réapparaisse dans l'aperçu multitâche du téléphone.
 *
 * Équivalent clavier : maintien de la barre d'espace, bouton focalisé.
 */
export function IdentityCard({
  identityName,
  identityId = null,
  slot = null,
  compact = false,
}: IdentityCardProps) {
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
  const portraitPx = compact ? PORTRAIT_PX.compact : PORTRAIT_PX.full;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={[
          'w-full rounded-card bg-ink text-center shadow-card',
          compact ? 'px-5 py-4' : 'px-6 py-9',
        ].join(' ')}
      >
        <p className="font-display text-[0.7rem] font-extrabold uppercase tracking-[0.22em] text-sun">
          Ta carte Mystère
        </p>

        {visible ? (
          <>
            {/*
              Le portrait vit dans la branche visible : masquer la carte le
              retire du document, comme le nom. Rien ne reste à l'écran — ni
              dans l'aperçu multitâche du téléphone.
            */}
            {identityId ? (
              <div className={['flex justify-center', compact ? 'mt-2' : 'mt-4'].join(' ')}>
                <Portrait
                  identityId={identityId}
                  name={identityName}
                  size={compact ? 'md' : 'lg'}
                  px={portraitPx}
                  onDark
                  className="ring-4 ring-sun/70"
                />
              </div>
            ) : null}
            {slot !== null ? (
              <p className="mt-1 font-display text-sm font-extrabold uppercase tracking-widest text-white/60">
                Numéro {slot}
              </p>
            ) : null}
            <p
              className={[
                'mt-2 break-words font-display font-black text-white',
                compact ? 'text-2xl' : 'text-4xl leading-tight',
              ].join(' ')}
            >
              {identityName}
            </p>
          </>
        ) : (
          <>
            {/*
              Même place que le portrait, vide : la carte ne rétrécit pas au
              masquage, et le bouton « Maintenir pour voir » ne se dérobe pas
              sous le doigt quand le portrait réapparaît.
            */}
            {identityId ? (
              <div
                className={['flex justify-center', compact ? 'mt-2' : 'mt-4'].join(' ')}
                aria-hidden="true"
              >
                <span
                  className={[
                    'flex items-center justify-center rounded-full bg-white/10 font-display font-black text-white/35 ring-4 ring-white/10',
                    compact ? 'text-2xl' : 'text-5xl',
                  ].join(' ')}
                  style={{ width: portraitPx, height: portraitPx }}
                >
                  ?
                </span>
              </div>
            ) : null}
            <p
              className={[
                'mt-2 font-display font-black uppercase tracking-widest text-white/35',
                compact ? 'text-xl' : 'text-3xl',
              ].join(' ')}
            >
              Carte masquée
            </p>
          </>
        )}
      </div>

      {masked ? (
        <button
          type="button"
          onPointerDown={(event) => {
            // La carte grandit en se dévoilant et pousse le bouton vers le bas :
            // sans capture, une souris immobile se retrouvait « sortie » du
            // bouton et la carte se recachait aussitôt. Le doigt, lui, est
            // capturé d'office — la souris se comporte désormais pareil.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Pointeur déjà relâché : rien à capturer.
            }
            setPeeking(true);
          }}
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
          👁 Masquer ma carte
        </button>
      )}
    </div>
  );
}
