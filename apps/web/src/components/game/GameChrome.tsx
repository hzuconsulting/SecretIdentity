'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Phase } from '@identite-secrete/shared';
import { ShareCode } from '@/components/lobby/ShareCode';
import { RulesSheet } from '@/components/rules/RulesSheet';
import { Button } from '@/components/ui/Button';
import { SoundToggle } from '@/components/ui/SoundToggle';
import { Sheet } from './Sheet';

/**
 * L'« habillage » de la partie : ce qui entoure chaque écran de phase sans en
 * faire partie — le code, les règles, le retour à l'accueil, le départ.
 *
 * Il est fourni par `GameClient` et lu par `PhaseShell` et le salon. Les
 * panneaux (règles, menu) sont rendus **ici**, au-dessus de l'écran de phase et
 * non à sa place : ouvrir les règles ne démonte rien, et un boîtier à moitié
 * rempli est toujours là à la fermeture.
 */

export interface GameChromeValue {
  code: string;
  isHost: boolean;
  /** `true` si le moteur de la partie tourne sur ce téléphone. */
  hosting: boolean;
  phase: Phase;
  openRules: () => void;
  openMenu: () => void;
  /** Ouvre la confirmation de départ. */
  requestLeave: () => void;
  /** Quitte pour de bon — sans confirmation. */
  leaveGame: () => Promise<void>;
  /** Retour à l'accueil **sans** quitter : la partie continue, on peut revenir. */
  goHome: () => void;
}

const GameChromeContext = createContext<GameChromeValue | null>(null);

/** `null` hors d'une partie : les consommateurs doivent savoir s'en passer. */
export function useGameChrome(): GameChromeValue | null {
  return useContext(GameChromeContext);
}

type OpenSheet = 'none' | 'rules' | 'menu' | 'leave';

interface GameChromeProviderProps {
  code: string;
  isHost: boolean;
  hosting: boolean;
  phase: Phase;
  /** Départ effectif : `leave()` de la connexion, puis retour à l'accueil. */
  onLeave: () => Promise<void>;
  children: ReactNode;
}

export function GameChromeProvider({
  code,
  isHost,
  hosting,
  phase,
  onLeave,
  children,
}: GameChromeProviderProps) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSheet>('none');
  const [leaving, setLeaving] = useState(false);

  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  const close = useCallback(() => setOpen('none'), []);
  const openRules = useCallback(() => setOpen('rules'), []);
  const openMenu = useCallback(() => setOpen('menu'), []);
  const requestLeave = useCallback(() => setOpen('leave'), []);

  const goHome = useCallback(() => {
    setOpen('none');
    // Navigation côté client : le nœud réseau est un singleton de module, il
    // survit au changement de page. L'hôte continue d'héberger, l'invité reste
    // connecté, et `/game?c=…` le ramène exactement où il en était.
    router.push('/');
  }, [router]);

  const leaveGame = useCallback(async () => {
    setLeaving(true);
    try {
      await onLeaveRef.current();
    } finally {
      setLeaving(false);
    }
  }, []);

  const value = useMemo<GameChromeValue>(
    () => ({
      code,
      isHost,
      hosting,
      phase,
      openRules,
      openMenu,
      requestLeave,
      leaveGame,
      goHome,
    }),
    [code, isHost, hosting, phase, openRules, openMenu, requestLeave, leaveGame, goHome],
  );

  const inLobby = phase === 'LOBBY';

  return (
    <GameChromeContext.Provider value={value}>
      {children}

      <RulesSheet open={open === 'rules'} onClose={close} />

      <Sheet
        open={open === 'menu' || open === 'leave'}
        onClose={leaving ? () => {} : close}
        title={open === 'leave' ? (inLobby ? 'Quitter le salon ?' : 'Quitter la partie ?') : 'Partie en cours'}
      >
        {open === 'leave' ? (
          <LeaveConfirmation
            code={code}
            hosting={hosting}
            inLobby={inLobby}
            leaving={leaving}
            onStay={close}
            onLeave={() => void leaveGame()}
          />
        ) : (
          <GameMenu
            code={code}
            hosting={hosting}
            inLobby={inLobby}
            onRules={openRules}
            onHome={goHome}
            onLeave={requestLeave}
          />
        )}
      </Sheet>
    </GameChromeContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────
//  Barre d'en-tête
// ─────────────────────────────────────────────────────────────

/**
 * Le bandeau du haut, sur tous les écrans de phase.
 *
 * Le code est toujours visible : c'est ce qu'on lit à voix haute à celui qui
 * vient de fermer l'appli par erreur. À droite, les règles, le son et le menu —
 * trois cibles de 44 px, le minimum pour un pouce.
 */
export function GameChromeBar() {
  const chrome = useGameChrome();
  if (!chrome) return null;

  return (
    <div className="flex items-center justify-between gap-2">
      <CodeChip code={chrome.code} onCopyFailed={chrome.openMenu} />

      <div className="flex items-center gap-2">
        <RulesButton />
        <SoundToggle />
        <button
          type="button"
          onClick={chrome.openMenu}
          aria-haspopup="dialog"
          aria-label="Menu de la partie : accueil, quitter"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-tile transition-transform duration-150 active:translate-y-0.5 active:shadow-tile-active"
        >
          <MenuIcon />
        </button>
      </div>
    </div>
  );
}

/** Bouton « Règles » : ouvre le panneau, ne quitte jamais l'écran. */
export function RulesButton({ className }: { className?: string }) {
  const chrome = useGameChrome();
  if (!chrome) return null;

  return (
    <button
      type="button"
      onClick={chrome.openRules}
      aria-haspopup="dialog"
      className={[
        'inline-flex min-h-[44px] items-center rounded-full bg-violet-light px-4',
        'font-display text-xs font-extrabold uppercase tracking-widest text-violet-dark',
        'transition-colors duration-150 hover:bg-violet/15',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      Règles
    </button>
  );
}

type CopyState = 'idle' | 'copied';

/**
 * Le code, en pastille. Une tape le copie.
 *
 * Si le presse-papier est refusé (contexte non sécurisé, permission iOS), on
 * ouvre le menu, où le code est affiché en grand avec le bouton de partage.
 */
function CodeChip({ code, onCopyFailed }: { code: string; onCopyFailed: () => void }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState('idle'), 2_000);
    } catch {
      onCopyFailed();
    }
  }

  const copied = state === 'copied';

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={`Code de la partie : ${code.split('').join(' ')}. Appuie pour le copier.`}
      className="flex min-h-[44px] min-w-0 items-center gap-2 rounded-full bg-white py-1 pl-4 pr-3 shadow-tile transition-transform duration-150 active:translate-y-0.5 active:shadow-tile-active"
    >
      <span className="flex flex-col items-start leading-none">
        <span
          className={[
            'font-display text-[0.6rem] font-extrabold uppercase tracking-widest',
            copied ? 'text-mint' : 'text-muted',
          ].join(' ')}
          aria-hidden="true"
        >
          {copied ? 'Copié !' : 'Code'}
        </span>
        <span
          className="mt-0.5 font-display text-base font-black tracking-[0.18em] text-ink"
          aria-hidden="true"
        >
          {code}
        </span>
      </span>
      <span
        className={['text-sm', copied ? 'text-mint' : 'text-muted'].join(' ')}
        aria-hidden="true"
      >
        {copied ? '✓' : <CopyIcon />}
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Code copié' : ''}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
//  Contenu du menu
// ─────────────────────────────────────────────────────────────

interface GameMenuProps {
  code: string;
  hosting: boolean;
  inLobby: boolean;
  onRules: () => void;
  onHome: () => void;
  onLeave: () => void;
}

function GameMenu({ code, hosting, inLobby, onRules, onHome, onLeave }: GameMenuProps) {
  return (
    <div className="flex flex-col gap-4">
      <ShareCode code={code} />

      <ul className="flex flex-col gap-2">
        <li>
          <MenuItem
            icon="📖"
            title="Règles du jeu"
            detail="Sans quitter la partie."
            onClick={onRules}
          />
        </li>
        <li>
          <MenuItem
            icon="🏠"
            title="Accueil"
            detail={
              hosting
                ? 'La partie continue sur ton téléphone : garde l’appli ouverte, et reviens quand tu veux.'
                : 'La partie continue sans toi à l’écran : tu reviens quand tu veux.'
            }
            onClick={onHome}
          />
        </li>
        <li>
          <MenuItem
            icon="🚪"
            title={inLobby ? 'Quitter le salon' : 'Quitter la partie'}
            detail="On te demandera de confirmer."
            tone="danger"
            onClick={onLeave}
          />
        </li>
      </ul>
    </div>
  );
}

interface MenuItemProps {
  icon: string;
  title: string;
  detail: string;
  tone?: 'default' | 'danger';
  onClick: () => void;
}

function MenuItem({ icon, title, detail, tone = 'default', onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-tile bg-white px-4 py-3 text-left shadow-tile transition-[transform,background-color,box-shadow] duration-150 hover:bg-violet-light active:translate-y-1 active:shadow-tile-active"
    >
      <span
        className={[
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg',
          tone === 'danger' ? 'bg-pink-light' : 'bg-violet-light',
        ].join(' ')}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            'block font-display text-base font-extrabold',
            tone === 'danger' ? 'text-pink' : 'text-ink',
          ].join(' ')}
        >
          {title}
        </span>
        <span className="block text-sm text-muted">{detail}</span>
      </span>
    </button>
  );
}

interface LeaveConfirmationProps {
  code: string;
  hosting: boolean;
  inLobby: boolean;
  leaving: boolean;
  onStay: () => void;
  onLeave: () => void;
}

/**
 * Confirmation de départ.
 *
 * Elle dit ce qu'on perd — et surtout ce qu'on ne perd pas : sa place. L'hôte
 * est prévenu à part, parce que son départ a une conséquence pour les autres.
 */
function LeaveConfirmation({
  code,
  hosting,
  inLobby,
  leaving,
  onStay,
  onLeave,
}: LeaveConfirmationProps) {
  const actionsRef = useRef<HTMLDivElement>(null);

  // Le bouton qui a ouvert cette étape vient de disparaître : sans ça, le
  // focus retomberait sur la page. « Rester » est le choix sans risque.
  useEffect(() => {
    actionsRef.current?.querySelector('button')?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card bg-white p-5 shadow-card">
        <p className="text-center text-4xl" aria-hidden="true">
          🚪
        </p>
        <p className="mt-2 text-center text-base font-semibold text-ink">
          {inLobby ? (
            <>
              Tu sors du salon. Tu pourras revenir avec le code{' '}
              <strong className="tracking-widest">{code}</strong> tant que la partie n’est
              pas lancée.
            </>
          ) : (
            <>
              Tu gardes ta place : tu pourras revenir avec le code{' '}
              <strong className="tracking-widest">{code}</strong> et le même pseudo.
            </>
          )}
        </p>

        {hosting ? (
          <p className="mt-4 rounded-tile bg-sun-light px-4 py-3 text-sm font-semibold text-ink">
            <span aria-hidden="true">⚠️ </span>
            La partie tourne sur ton téléphone. En partant, tu passes la main : un autre
            joueur prendra le relais pour l’héberger.
          </p>
        ) : null}

        {!inLobby ? (
          <p className="mt-3 text-center text-sm text-muted">
            Juste une pause&nbsp;? « Accueil » te laisse dans la partie.
          </p>
        ) : null}
      </div>

      <div ref={actionsRef} className="flex gap-2">
        <Button variant="soft" size="md" onClick={onStay} disabled={leaving}>
          Rester
        </Button>
        <Button variant="accent" size="md" onClick={onLeave} disabled={leaving}>
          {leaving ? 'Départ…' : 'Quitter'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Icônes
// ─────────────────────────────────────────────────────────────

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path
        d="M3 5.5h14M3 10h14M3 14.5h14"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M11 3.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v6.5A1.5 1.5 0 0 0 3 11h.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
