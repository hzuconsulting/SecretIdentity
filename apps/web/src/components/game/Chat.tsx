'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import {
  MAX_CHAT_LENGTH,
  type ChatMessage,
  type GameError,
  type PlayerId,
} from '@identite-secrete/shared';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { useSound } from '@/hooks/useSound';

/**
 * La discussion de la partie : un bouton, une liste, un champ.
 *
 * Les messages arrivent dans la vue joueur, comme tout le reste ; rien n'est
 * affiché avant que l'hôte ne l'ait reçu. Le panneau lui-même est le `Sheet`
 * commun, monté par `GameChromeProvider` — la discussion s'ouvre donc par-dessus
 * n'importe quel écran, pause comprise, sans en démonter aucun.
 */

// ─────────────────────────────────────────────────────────────
//  Bouton flottant
// ─────────────────────────────────────────────────────────────

/**
 * Marge basse des écrans de partie : le bouton (56 px), son écart au bord, et
 * un peu d'air. Sans elle, le bouton recouvre le bouton d'action en fin de page.
 * En style inline : Tailwind réécrirait le `calc()`.
 */
export const CHAT_BUTTON_CLEARANCE = 'calc(6rem + env(safe-area-inset-bottom))';

interface ChatButtonProps {
  unread: number;
  /** Remonte le bouton au-dessus du bandeau « la partie tourne sur ton téléphone ». */
  raised: boolean;
  onOpen: () => void;
}

/**
 * En bas à droite, sous le pouce, sur tous les écrans de la partie.
 *
 * Au-dessus de la pause (`z-40`) : c'est quand on attend un absent qu'on a le
 * plus envie de s'écrire. Sous les toasts et les panneaux.
 */
export function ChatButton({ unread, raised, onOpen }: ChatButtonProps) {
  const label =
    unread === 0
      ? 'Ouvrir la discussion'
      : `Ouvrir la discussion : ${unread} ${unread === 1 ? 'nouveau message' : 'nouveaux messages'}`;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[46] mx-auto flex w-full max-w-md justify-end px-4"
      style={{
        paddingBottom: raised
          ? 'calc(max(1rem, env(safe-area-inset-bottom)) + 1.25rem)'
          : 'max(1rem, env(safe-area-inset-bottom))',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={label}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-violet text-white shadow-tile transition-transform duration-150 active:translate-y-0.5 active:shadow-tile-active"
      >
        <ChatIcon />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-pink px-1.5 font-display text-xs font-extrabold text-white shadow-tile"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Messages non lus
// ─────────────────────────────────────────────────────────────

/** Au plus un son par salve : cinq messages d'affilée ne font pas cinq bips. */
const SOUND_SPACING_MS = 1_500;

/**
 * Compte les messages des autres arrivés panneau fermé, et sonne à leur arrivée.
 *
 * L'historique déjà présent à l'entrée dans la partie ne compte pas : revenir
 * après un rechargement ne doit pas afficher trente messages « nouveaux ».
 */
export function useChatUnread(messages: ChatMessage[], youId: PlayerId, open: boolean): number {
  const { play } = useSound();
  const [unread, setUnread] = useState(0);
  const seen = useRef<Set<string> | null>(null);
  const lastSound = useRef(0);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(messages.map((message) => message.id));
      return;
    }

    const known = seen.current;
    const fresh = messages.filter((message) => !known.has(message.id));
    if (fresh.length === 0) return;
    for (const message of fresh) known.add(message.id);

    const fromOthers = fresh.filter((message) => message.playerId !== youId).length;
    if (fromOthers === 0 || open) return;

    setUnread((count) => count + fromOthers);

    const now = Date.now();
    if (now - lastSound.current > SOUND_SPACING_MS) {
      lastSound.current = now;
      play('message');
    }
  }, [messages, youId, open, play]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  return unread;
}

// ─────────────────────────────────────────────────────────────
//  Liste
// ─────────────────────────────────────────────────────────────

/** En deçà, on considère qu'on lit le bas de la conversation. */
const NEAR_BOTTOM_PX = 48;

interface ChatMessagesProps {
  messages: ChatMessage[];
  youId: PlayerId;
}

export function ChatMessages({ messages, youId }: ChatMessagesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const last = messages[messages.length - 1];
  const lastId = last?.id;
  const lastIsMine = last?.playerId === youId;

  // Le défilement est celui du corps du panneau, pas de la liste : c'est lui
  // qui a la hauteur fixe.
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>('[data-sheet-body]');
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;

    const onScroll = () => {
      atBottom.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM_PX;
    };

    // Le clavier qui monte rétrécit le panneau : on garde le dernier message
    // en vue, sauf si l'on était remonté lire plus haut.
    const resize = new ResizeObserver(() => {
      if (atBottom.current) scroller.scrollTop = scroller.scrollHeight;
    });

    scroller.addEventListener('scroll', onScroll, { passive: true });
    resize.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', onScroll);
      resize.disconnect();
    };
  }, []);

  // Un nouveau message ne tire vers le bas que si l'on y était déjà — ou si
  // c'est le sien : on veut voir partir ce qu'on vient d'écrire.
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>('[data-sheet-body]');
    if (!scroller || lastId === undefined) return;
    if (atBottom.current || lastIsMine) {
      scroller.scrollTop = scroller.scrollHeight;
      atBottom.current = true;
    }
  }, [lastId, lastIsMine]);

  return (
    <div ref={rootRef} className="flex min-h-full flex-col justify-end">
      {messages.length === 0 ? (
        <p className="py-8 text-center text-base font-semibold text-muted">
          Aucun message pour l’instant. Dis bonjour à la table&nbsp;!
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5 py-2" aria-live="polite" aria-relevant="additions">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const mine = message.playerId === youId;
            // Le nom n'est répété que quand l'auteur change, comme dans toutes
            // les messageries : sinon il mange la moitié de l'écran.
            const showAuthor = !mine && previous?.playerId !== message.playerId;

            return (
              <li
                key={message.id}
                className={[
                  'flex flex-col',
                  mine ? 'items-end' : 'items-start',
                  showAuthor && index > 0 ? 'mt-2' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {showAuthor ? (
                  <span className="mb-1 flex items-center gap-1.5 px-1" aria-hidden="true">
                    <PlayerAvatar
                      playerId={message.playerId}
                      nickname={message.nickname}
                      size="xs"
                    />
                    <span className="font-display text-xs font-extrabold text-muted">
                      {message.nickname}
                    </span>
                  </span>
                ) : null}
                <p
                  className={[
                    'max-w-[85%] rounded-tile px-3.5 py-2 text-base leading-snug [overflow-wrap:anywhere]',
                    mine ? 'bg-violet text-white' : 'bg-white text-ink shadow-tile',
                  ].join(' ')}
                >
                  <span className="sr-only">{mine ? 'Toi' : message.nickname}&nbsp;: </span>
                  {message.text}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Saisie
// ─────────────────────────────────────────────────────────────

interface ChatComposerProps {
  onSend: (text: string) => Promise<GameError | null>;
}

/**
 * Le champ, en pied de panneau.
 *
 * Il n'est jamais désactivé pendant l'envoi : sur un téléphone, désactiver le
 * champ qui a le focus referme le clavier, et on veut pouvoir enchaîner. Le
 * texte est vidé tout de suite, et remis en place si l'hôte le refuse.
 */
export function ChatComposer({ onSend }: ChatComposerProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sur ordinateur, on peut écrire tout de suite. Sur téléphone, pas de focus
  // automatique : le clavier recouvrirait les messages avant qu'on les ait lus.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();

    const value = text.trim();
    if (value.length === 0 || sending.current) return;

    sending.current = true;
    setText('');
    setError(null);

    const failure = await onSend(value);
    sending.current = false;

    if (failure) {
      // Ne pas écraser ce qu'on aurait commencé à retaper entre-temps.
      setText((current) => (current.length === 0 ? value : current));
      setError(failure.message);
    }
  }

  // Toucher « Envoyer » ne doit pas retirer le focus du champ : le clavier se
  // refermerait à chaque message.
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  return (
    <div>
      <p className="mb-2 text-center text-xs font-semibold text-muted">
        <span aria-hidden="true">🤫 </span>Ne dévoile pas ton numéro&nbsp;!
      </p>

      <form onSubmit={(event) => void submit(event)} className="flex items-stretch gap-2">
        <label htmlFor="chat-message" className="sr-only">
          Ton message
        </label>
        <input
          ref={inputRef}
          id="chat-message"
          type="text"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error) setError(null);
          }}
          maxLength={MAX_CHAT_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Écris un message…"
          // 16 px au moins : en dessous, iOS zoome sur le champ au focus.
          className="min-h-[48px] min-w-0 flex-1 rounded-tile bg-white px-4 text-base font-semibold text-ink shadow-tile placeholder:font-normal placeholder:text-muted/60"
        />
        <button
          type="submit"
          onMouseDown={keepFocus}
          disabled={text.trim().length === 0}
          className="flex min-h-[48px] shrink-0 items-center justify-center rounded-tile bg-violet px-4 font-display text-sm font-extrabold uppercase tracking-wide text-white shadow-tile transition-[transform,opacity] duration-150 active:translate-y-0.5 active:shadow-tile-active disabled:opacity-40"
        >
          Envoyer
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-pink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Icône
// ─────────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4.5 3.5c-.5.4-1.5.1-1.5-.6V17a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="currentColor"
      />
      <circle cx="8" cy="10.5" r="1.3" fill="#5B3DF5" />
      <circle cx="12" cy="10.5" r="1.3" fill="#5B3DF5" />
      <circle cx="16" cy="10.5" r="1.3" fill="#5B3DF5" />
    </svg>
  );
}
