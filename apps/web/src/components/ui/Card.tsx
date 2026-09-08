import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}

export function Card({ children, className, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={['rounded-card bg-white p-6 shadow-card', className].filter(Boolean).join(' ')}
    >
      {children}
    </Tag>
  );
}

interface EyebrowProps {
  children: ReactNode;
  tone?: 'violet' | 'pink' | 'mint' | 'sun';
}

const TONES: Record<NonNullable<EyebrowProps['tone']>, string> = {
  violet: 'bg-violet-light text-violet-dark',
  pink: 'bg-pink-light text-pink',
  mint: 'bg-mint-light text-mint',
  sun: 'bg-sun-light text-ink',
};

/** Petite étiquette de section — sert à typer l'information, pas à décorer. */
export function Eyebrow({ children, tone = 'violet' }: EyebrowProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1',
        'font-display text-xs font-extrabold uppercase tracking-widest',
        TONES[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
