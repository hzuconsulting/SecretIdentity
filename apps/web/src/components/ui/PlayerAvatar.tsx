import { avatarColor, avatarInitial } from '@identite-secrete/shared';

interface PlayerAvatarProps {
  playerId: string;
  nickname: string;
  /**
   * `fill` occupe toute la boîte du parent et hérite de sa taille de police :
   * c'est ce qui sert de repli aux portraits, dont la taille est fixée ailleurs.
   */
  size?: 'xs' | 'sm' | 'md' | 'fill';
  dimmed?: boolean;
}

const SIZES = {
  xs: 'h-5 w-5 text-[0.65rem]',
  sm: 'h-9 w-9 text-base',
  md: 'h-12 w-12 text-xl',
  fill: 'h-full w-full',
} as const;

/**
 * Avatar dérivé de l'identifiant du joueur : initiale + couleur stable.
 * Pas d'upload, pas de service externe, et deux joueurs gardent la même
 * couleur d'une manche à l'autre.
 *
 * Sert aussi de repli aux personnages sans portrait (`Portrait`) : l'identifiant
 * du personnage y tient lieu de graine de couleur.
 */
export function PlayerAvatar({
  playerId,
  nickname,
  size = 'md',
  dimmed = false,
}: PlayerAvatarProps) {
  return (
    <span
      className={[
        'flex shrink-0 items-center justify-center rounded-full font-display font-black text-white',
        SIZES[size],
        dimmed ? 'opacity-40' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: avatarColor(playerId) }}
      aria-hidden="true"
    >
      {avatarInitial(nickname)}
    </span>
  );
}
