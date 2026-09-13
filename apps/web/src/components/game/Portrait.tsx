'use client';

import { useState } from 'react';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { portraitUrl, usePortrait } from '@/lib/portraits';

export type PortraitSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * Tailles affichées, en pixels CSS. Un seul fichier par personnage (192 px) :
 * il sert à toutes, et une photo vue sur le plateau est déjà en cache quand
 * elle revient sur la carte.
 */
const SIZES: Record<PortraitSize, number> = {
  xs: 20,
  sm: 32,
  md: 40,
  lg: 96,
};

interface PortraitProps {
  identityId: string;
  /** Nom du personnage : sert à l'initiale de repli. Il est toujours écrit à côté. */
  name: string;
  size?: PortraitSize;
  /** Taille affichée, quand aucune des quatre ne convient (carte Mystère compacte). */
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
  const box = px ?? SIZES[size];

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
      <PortraitImage key={identityId} identityId={identityId} name={name} box={box} />
    </span>
  );
}

interface PortraitImageProps {
  identityId: string;
  name: string;
  box: number;
}

function PortraitImage({ identityId, name, box }: PortraitImageProps) {
  const { entry, ready } = usePortrait(identityId);
  const [failed, setFailed] = useState(false);

  // Liste pas encore arrivée : on ne sait pas s'il faut attendre une photo.
  // Le carré reste vide plutôt que d'afficher une initiale qui disparaîtrait.
  if (!ready) return null;

  if (!entry || failed) {
    return <PlayerAvatar playerId={identityId} nickname={name} size="fill" />;
  }

  // Un `<img>` nu plutôt que `next/image` : en export statique, il n'y a aucun
  // serveur pour optimiser, et la photo est déjà recadrée et réduite.
  return (
    <img
      src={portraitUrl(identityId, entry)}
      alt=""
      width={box}
      height={box}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
