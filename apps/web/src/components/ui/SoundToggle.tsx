'use client';

import { useSound } from '@/hooks/useSound';

/**
 * Coupure du son.
 *
 * Toujours au même endroit, dans l'en-tête, sur tous les écrans de jeu : on ne
 * cherche pas un bouton de mise en sourdine dans un menu quand le téléphone
 * sonne au mauvais moment.
 */
export function SoundToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useSound();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? 'Couper les sons' : 'Activer les sons'}
      title={enabled ? 'Sons activés' : 'Sons coupés'}
      className={[
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg',
        'transition-colors duration-150',
        enabled ? 'bg-violet-light text-violet-dark' : 'bg-white text-muted',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true">{enabled ? '🔊' : '🔇'}</span>
    </button>
  );
}
