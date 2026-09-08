'use client';

import { AnimatePresence, motion } from 'framer-motion';
import type { GameError, ToastPayload } from '@identite-secrete/shared';

interface ErrorBannerProps {
  error: GameError | null;
  onDismiss?: () => void;
}

/**
 * Une erreur explique ce qui s'est passé et ce qu'on peut faire.
 * Elle ne s'excuse pas, et elle n'est jamais vague.
 */
export function ErrorBanner({ error, onDismiss }: ErrorBannerProps) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-tile bg-pink-light px-4 py-3 text-sm font-semibold text-ink"
    >
      <span aria-hidden="true">⚠️</span>
      <span className="flex-1">
        {error.message}
        {error.suggestion ? (
          <span className="mt-1 block font-normal text-ink/70">
            Essaie plutôt&nbsp;: <strong>{error.suggestion}</strong>
          </span>
        ) : null}
      </span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer le message"
          className="min-h-[24px] px-1 text-lg leading-none text-ink/50"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

interface ToastStackProps {
  toasts: Array<ToastPayload & { id: number }>;
}

const TONES: Record<ToastPayload['tone'], string> = {
  info: 'bg-ink text-white',
  success: 'bg-mint text-white',
  warning: 'bg-sun text-ink',
};

/** Messages courts et non bloquants : arrivée, départ, changement d'hôte. */
export function ToastStack({ toasts }: ToastStackProps) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-5"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.p
            key={toast.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className={`rounded-full px-5 py-2.5 text-sm font-semibold shadow-card ${TONES[toast.tone]}`}
          >
            {toast.message}
          </motion.p>
        ))}
      </AnimatePresence>
    </div>
  );
}
