import { avatarColor, avatarInitial } from '@identite-secrete/shared';

interface PlayerAvatarProps {
  playerId: string;
  nickname: string;
  size?: 'sm' | 'md';
  dimmed?: boolean;
}

const SIZES = {
  sm: 'h-9 w-9 text-base',
  md: 'h-12 w-12 text-xl',
} as const;

/**
 * Avatar dérivé de l'identifiant du joueur : initiale + couleur stable.
 * Pas d'upload, pas de service externe, et deux joueurs gardent la même
 * couleur d'une manche à l'autre.
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
