import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'soft' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-violet text-white shadow-tile active:shadow-tile-active hover:bg-violet-dark',
  accent: 'bg-pink text-white shadow-tile active:shadow-tile-active hover:brightness-95',
  soft: 'bg-white text-ink shadow-tile active:shadow-tile-active hover:bg-violet-light',
  ghost: 'bg-transparent text-ink hover:bg-white/70',
};

const SIZES: Record<ButtonSize, string> = {
  // Cibles tactiles : 48 px minimum, 56 px pour les actions principales.
  md: 'min-h-[48px] px-5 text-base',
  lg: 'min-h-[56px] px-6 text-lg',
};

const BASE =
  'inline-flex w-full items-center justify-center gap-2 rounded-tile font-display font-extrabold ' +
  'uppercase tracking-wide transition-[transform,background-color,box-shadow] duration-150 ' +
  'active:translate-y-1 disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none';

function classes(variant: ButtonVariant, size: ButtonSize, className?: string): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ');
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = 'primary',
  size = 'lg',
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classes(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

interface ButtonLinkProps extends CommonProps {
  href: string;
}

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'lg',
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link href={href} className={classes(variant, size, className)}>
      {children}
    </Link>
  );
}
