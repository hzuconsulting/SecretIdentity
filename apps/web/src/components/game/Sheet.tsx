'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Titre lu à l'ouverture par les lecteurs d'écran, et affiché en tête. */
  title: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Panneau qui monte du bas de l'écran, **par-dessus** la partie.
 *
 * C'est tout son intérêt : l'écran de phase reste monté derrière, avec son état
 * local — un boîtier à moitié rempli survit à la lecture des règles. Une
 * navigation vers une autre page, elle, l'aurait perdu.
 *
 * Dialogue modal accessible : le focus y entre à l'ouverture, n'en sort pas au
 * clavier (Tab boucle), revient au bouton d'origine à la fermeture ; Échap et le
 * fond ferment. Rendu dans un portail, au-dessus de la pause et des toasts.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Le portail vise `document.body` : il n'existe qu'après l'hydratation.
  useEffect(() => setMounted(true), []);

  // `onClose` change à chaque rendu du parent : une référence évite de
  // réabonner le clavier (et de voler le focus) à chaque fois.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Effet de mise en page, pas passif : il doit noter l'élément qui avait le
  // focus *avant* que le contenu du panneau ne le déplace dans ses propres
  // effets — sinon on ne saurait plus où le rendre à la fermeture.
  useLayoutEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Le fond ne défile plus sous le doigt pendant la lecture. On ne touche pas
    // à la position : à la fermeture, on retrouve l'écran exactement où il était.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';

    // Le focus entre dans le panneau — sauf si son contenu l'a déjà placé
    // lui-même sur un bouton précis (la confirmation de départ le fait).
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) panel.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);

      if (focusables.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      root.style.overflow = previousOverflow;
      // Retour au bouton qui a ouvert, s'il est toujours là.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center" key="sheet">
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-ink/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={onClose}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            transition={
              reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 36 }
            }
            // En style plutôt qu'en classe arbitraire : Tailwind réécrit les
            // opérateurs de `calc()` et casserait `safe-area-inset-top`.
            style={{ maxHeight: 'calc(100dvh - max(1.5rem, env(safe-area-inset-top) + 0.5rem))' }}
            className="relative flex w-full max-w-md flex-col rounded-t-card bg-lilac shadow-card outline-none"
          >
            <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-4">
              <h2
                id={titleId}
                className="min-w-0 font-display text-xl font-black uppercase leading-tight tracking-tight"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fermer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl font-black text-ink shadow-tile active:translate-y-0.5 active:shadow-tile-active"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
