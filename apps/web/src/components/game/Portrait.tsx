'use client';

import { useState } from 'react';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { portraitUrl, usePortrait, type PortraitWidth } from '@/lib/portraits';

export type PortraitSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Tailles affichées, en pixels CSS, et vignette demandée à Commons.
 *
 * Deux largeurs de vignette seulement, pour que le cache du service worker les
 * partage d'un écran à l'autre : 120 px couvre jusqu'à ~56 px affichés sur un
 * écran 2×, 250 px la grande carte Mystère.
 */
const SIZES: Record<PortraitSize, { px: number; thumb: PortraitWidth }> = {
  xs: { px: 20, thumb: 120 },
  sm: { px: 32, thumb: 120 },
  md: { px: 40, thumb: 120 },
  lg: { px: 96, thumb: 250 },
};

interface PortraitProps {
  identityId: string;
  /** Nom du personnage : sert à l'initiale de repli. Il est toujours écrit à côté. */
  name: string;
  size?: PortraitSize;
  /**
   * Taille affichée, quand aucune des quatre ne convient (carte Mystère
   * compacte). La vignette reste celle de `size`.
   */
  px?: number;
  /** Fond sombre : la place réservée pendant le chargement s'éclaircit au lieu de s'assombrir. */
  onDark?: boolean;
  className?: string;
}

/**
 * La photo d'un personnage, ronde, ou son initiale s'il n'en a pas.
 *
 * Purement décorative (`alt=""`, `aria-hidden`) : le nom est toujours écrit à
 * côté, et le lecteur d'écran n'a pas à entendre deux fois la même chose.
 *
 * La boîte est réservée d'emblée et ne change jamais de taille : chargement de
 * la liste, photo, puis éventuellement repli sur l'initiale se succèdent dans
 * le même carré, sans décaler ce qui l'entoure.
 */
export function Portrait({
  identityId,
  name,
  size = 'sm',
  px,
  onDark = false,
  className,
}: PortraitProps) {
  const { px: defaultPx, thumb } = SIZES[size];
  const box = px ?? defaultPx;

  return (
    <span
      className={[
        'relative inline-flex shrink-0 overflow-hidden rounded-full',
        onDark ? 'bg-white/15' : 'bg-ink/10',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: box, height: box, fontSize: Math.max(10, Math.round(box * 0.45)) }}
      aria-hidden="true"
    >
      {/* Clé : un autre personnage repart de zéro, erreur de chargement comprise. */}
      <PortraitImage key={identityId} identityId={identityId} name={name} box={box} thumb={thumb} />
    </span>
  );
}

interface PortraitImageProps {
  identityId: string;
  name: string;
  box: number;
  thumb: PortraitWidth;
}

function PortraitImage({ identityId, name, box, thumb }: PortraitImageProps) {
  const { entry, ready } = usePortrait(identityId);
  const [failed, setFailed] = useState(false);

  // Liste pas encore arrivée : on ne sait pas s'il faut attendre une photo.
  // Le carré reste vide plutôt que d'afficher une initiale qui disparaîtrait.
  if (!ready) return null;

  if (!entry || failed) {
    return <PlayerAvatar playerId={identityId} nickname={name} size="fill" />;
  }

  // Un `<img>` nu plutôt que `next/image` : en export statique, il n'y a aucun
  // serveur pour optimiser, et Commons sert déjà la bonne largeur.
  return (
    <img
      src={portraitUrl(entry, thumb)}
      alt=""
      width={box}
      height={box}
      loading="lazy"
      decoding="async"
      // Commons répond `Access-Control-Allow-Origin: *` : en CORS, le service
      // worker peut garder la vignette sans payer le prix d'une réponse opaque.
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover object-[center_20%]"
    />
  );
}
