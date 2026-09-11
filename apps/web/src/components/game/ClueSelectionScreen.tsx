'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  MAX_PICTOS,
  MIN_PICTOS,
  TIMER_URGENT_SECONDS,
  getIcon,
  getIdentity,
  secondsRemaining,
  type GameError,
  type PictoCard,
  type PictoZone,
  type PlacedPicto,
  type PlayerId,
  type PlayerView,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSound } from '@/hooks/useSound';
import { IconTile } from '@/components/ui/IconTile';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Feedback';
import { BoardGrid } from './BoardGrid';
import { IdentityCard } from './IdentityCard';
import { PictoCase, ZoneLabel } from './PictoCase';
import { PhaseAnnouncement, PhaseShell } from './PhaseShell';
import { WaitingPanel } from './WaitingPanel';

interface ClueSelectionScreenProps {
  view: PlayerView;
  onSubmit: (placed: PlacedPicto[]) => Promise<GameError | null>;
  /** Exclusion par l'hôte, proposée depuis la liste d'attente. */
  onKick?: (playerId: PlayerId) => Promise<GameError | null>;
}

/** Marge avant l'échéance à laquelle le client valide tout seul. */
const AUTO_SUBMIT_AT_SECONDS = 1;

/**
 * Remplissage du boîtier.
 *
 * Trois décisions par pictogramme, là où il n'y en avait qu'une : **quelle
 * carte**, **quelle face** (chaque carte en porte deux, et jouer l'une jette
 * l'autre), et **quelle zone** — vert pour affirmer, rouge pour nier.
 *
 * Pour que ça reste jouable au pouce sur un téléphone, la zone est un **mode**
 * qu'on bascule une fois, pas une question posée à chaque carte : on choisit
 * « je pose en vert », puis on tape les faces voulues. Une tape sur un
 * pictogramme déjà posé le retire.
 *
 * Deux garde-fous côté interface, en plus de la validation du moteur :
 *  - la sélection est signalée par une bordure **et** un symbole ✓/✗, jamais par
 *    la couleur seule (§7.4) ;
 *  - la validation demande une confirmation, parce qu'elle est définitive — et
 *    plus encore qu'avant : les cartes jouées ne reviendront jamais.
 *
 * À une seconde de la fin, le client valide automatiquement ce qui est posé. Ce
 * n'est pas une décision de phase — le moteur reste seul maître du temps — mais
 * une action du joueur, envoyée à sa place. Si elle n'arrive pas à temps, ou si
 * le joueur est déconnecté, le moteur tire une carte de sa main.
 */
export function ClueSelectionScreen({ view, onSubmit, onKick }: ClueSelectionScreenProps) {
  const { serverNow } = useServerClock();
  const { play } = useSound();

  const [placed, setPlaced] = useState<PlacedPicto[]>(view.yourPlaced ?? []);
  const [zone, setZone] = useState<PictoZone>('green');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GameError | null>(null);

  const hand = useMemo(() => view.yourHand ?? [], [view.yourHand]);
  const identity = view.yourIdentityId ? getIdentity(view.yourIdentityId) : undefined;
  const submitted = view.yourCluesSubmitted === true;

  // `submit` est appelé depuis un minuteur : on passe par une référence pour
  // que l'effet d'auto-validation n'ait pas à se réabonner à chaque tape.
  const submitRef = useRef<((value: PlacedPicto[]) => Promise<void>) | null>(null);

  submitRef.current = async (value: PlacedPicto[]) => {
    if (busy || submitted || value.length < MIN_PICTOS) return;

    setBusy(true);
    setError(null);
    const failure = await onSubmit(value);
    if (failure) setError(failure);
    else play('confirm');
    setBusy(false);
    setConfirming(false);
  };

  useEffect(() => {
    if (submitted || view.phaseEndsAt === null) return;

    const interval = setInterval(() => {
      const remaining = secondsRemaining(view.phaseEndsAt, serverNow());
      if (remaining !== null && remaining <= AUTO_SUBMIT_AT_SECONDS) {
        clearInterval(interval);
        void submitRef.current?.(placed);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [submitted, view.phaseEndsAt, serverNow, placed]);

  /**
   * Tape sur une face.
   *
   * Trois cas, du plus courant au plus rare : la face est déjà posée → on la
   * retire ; l'autre face de la même carte est posée → on retourne la carte en
   * gardant sa zone ; sinon → on pose, si le boîtier n'est pas plein.
   */
  function tapFace(card: PictoCard, iconId: string) {
    if (submitted || busy) return;
    setError(null);

    setPlaced((current) => {
      const existing = current.find((picto) => picto.cardId === card.id);

      if (existing?.iconId === iconId) {
        play('deselect');
        return current.filter((picto) => picto.cardId !== card.id);
      }

      if (existing) {
        play('select');
        return current.map((picto) =>
          picto.cardId === card.id ? { ...picto, iconId } : picto,
        );
      }

      // Silencieusement ignoré au-delà du maximum : un message d'erreur pour une
      // tape de trop serait plus agaçant qu'utile. Le compteur dit déjà que le
      // boîtier est plein.
      if (current.length >= MAX_PICTOS) return current;

      play('select');
      return [...current, { cardId: card.id, iconId, zone }];
    });
  }

  function removeCard(cardId: string) {
    if (submitted || busy) return;
    play('deselect');
    setPlaced((current) => current.filter((picto) => picto.cardId !== cardId));
  }

  if (submitted) {
    return (
      <PhaseShell view={view} title="Boîtier validé">
        <PhaseAnnouncement label="Ton boîtier est validé. On attend les autres." />

        <div className="rounded-card bg-mint-light p-5 shadow-card">
          <p className="text-center text-3xl" aria-hidden="true">
            ✅
          </p>
          <p className="mt-1 text-center font-display text-xl font-black uppercase">
            Boîtier validé !
          </p>
          <div className="mt-4">
            <PictoCase placed={view.yourPlaced ?? []} />
          </div>
          <p className="mt-3 text-center text-sm font-semibold text-muted">
            Il te reste {view.you.cardsLeft - (view.yourPlaced?.length ?? 0)} carte
            {view.you.cardsLeft - (view.yourPlaced?.length ?? 0) > 1 ? 's' : ''} pour la
            suite.
          </p>
        </div>

        <WaitingPanel view={view} verb="a validé son boîtier" onKick={onKick} />
      </PhaseShell>
    );
  }

  const remaining = secondsRemaining(view.phaseEndsAt, serverNow());
  const urgent = remaining !== null && remaining <= TIMER_URGENT_SECONDS;
  const cardsAfter = hand.length - placed.length;

  return (
    <PhaseShell view={view} title="Ton boîtier">
      <PhaseAnnouncement label="Choisis les pictogrammes qui font deviner ton personnage." />

      <IdentityCard identityName={identity?.name ?? '—'} compact />

      {view.board ? <BoardGrid board={view.board} compact /> : null}

      {/* ── Le boîtier en cours ─────────────────────────────── */}
      <section aria-labelledby="boitier-titre" className="rounded-card bg-white p-4 shadow-card">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2
            id="boitier-titre"
            className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
          >
            Ce que tu poses
          </h2>
          <p className="font-display text-sm font-extrabold tabular-nums" aria-live="polite">
            {placed.length} / {MAX_PICTOS}
          </p>
        </div>

        {placed.length === 0 ? (
          <p className="text-sm font-semibold text-muted">
            Rien de posé pour l’instant. Tape un pictogramme de ta main.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {placed.map((picto) => {
              const icon = getIcon(picto.iconId);
              if (!icon) return null;

              return (
                <li key={picto.cardId}>
                  <button
                    type="button"
                    onClick={() => removeCard(picto.cardId)}
                    aria-label={`Retirer ${icon.label} du boîtier`}
                    className="rounded-tile transition-transform duration-150 active:scale-95"
                  >
                    <IconTile
                      icon={icon}
                      size="sm"
                      ring={picto.zone === 'green' ? 'ring-4 ring-mint' : 'ring-4 ring-pink'}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Le mode de pose ─────────────────────────────────── */}
      <section aria-labelledby="zone-titre">
        <h2
          id="zone-titre"
          className="mb-2 font-display text-xs font-extrabold uppercase tracking-widest text-muted"
        >
          Je pose en
        </h2>

        <div role="radiogroup" aria-labelledby="zone-titre" className="flex gap-2">
          {(['green', 'red'] as PictoZone[]).map((candidate) => {
            const active = zone === candidate;

            return (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setZone(candidate)}
                className={[
                  'flex min-h-[48px] flex-1 items-center justify-center rounded-tile px-3',
                  'shadow-tile transition-transform duration-150 active:translate-y-0.5',
                  active
                    ? candidate === 'green'
                      ? 'bg-mint-light ring-4 ring-mint'
                      : 'bg-pink-light ring-4 ring-pink'
                    : 'bg-white ring-1 ring-ink/5',
                ].join(' ')}
              >
                <ZoneLabel zone={candidate} />
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-sm font-semibold text-muted">
          {zone === 'green'
            ? 'Vert : « mon personnage, c’est ça ».'
            : 'Rouge : « mon personnage, ce n’est pas ça ».'}
        </p>
      </section>

      {/* ── La main ─────────────────────────────────────────── */}
      <section aria-labelledby="main-titre">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2
            id="main-titre"
            className="font-display text-xs font-extrabold uppercase tracking-widest text-muted"
          >
            Ta main — {hand.length} carte{hand.length > 1 ? 's' : ''}
          </h2>
          <p className="font-display text-sm font-extrabold tabular-nums">
            {cardsAfter} après cette manche
          </p>
        </div>

        <p className="mb-3 text-sm font-semibold text-muted">
          Chaque carte porte deux pictogrammes : tu n’en montres qu’un, et la carte
          entière part à la défausse. Elle ne sera pas remplacée.
        </p>

        <ul className="flex flex-col gap-2">
          {hand.map((card) => (
            <HandCard
              key={card.id}
              card={card}
              placed={placed.find((picto) => picto.cardId === card.id) ?? null}
              full={placed.length >= MAX_PICTOS}
              onTapFace={(iconId) => tapFace(card, iconId)}
            />
          ))}
        </ul>
      </section>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <AnimatePresence mode="wait">
          {confirming ? (
            <motion.div
              key="confirmation"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="rounded-card bg-white p-4 shadow-card"
            >
              <p className="text-center font-display text-base font-extrabold">
                Confirmer ce boîtier&nbsp;?
              </p>
              <p className="mt-1 text-center text-sm font-semibold text-muted">
                {placed.length} carte{placed.length > 1 ? 's' : ''} défaussée
                {placed.length > 1 ? 's' : ''} définitivement. Il t’en restera {cardsAfter}.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="soft"
                  size="md"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Modifier
                </Button>
                <Button
                  size="md"
                  onClick={() => void submitRef.current?.(placed)}
                  disabled={busy}
                >
                  {busy ? 'Envoi…' : 'Confirmer'}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="validation" initial={false}>
              <Button
                onClick={() => setConfirming(true)}
                disabled={placed.length < MIN_PICTOS || busy}
                variant={urgent ? 'accent' : 'primary'}
              >
                Valider mon boîtier
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-center text-sm font-semibold text-muted">
          {placed.length < MIN_PICTOS
            ? 'Pose au moins un pictogramme.'
            : 'Sans validation, ton boîtier partira tout seul à la fin du temps.'}
        </p>
      </div>
    </PhaseShell>
  );
}

// ─────────────────────────────────────────────────────────────

interface HandCardProps {
  card: PictoCard;
  /** Le pictogramme posé depuis cette carte, s'il y en a un. */
  placed: PlacedPicto | null;
  /** Boîtier plein : les cartes non posées deviennent inertes. */
  full: boolean;
  onTapFace: (iconId: string) => void;
}

/**
 * Une carte de la main, ses deux faces côte à côte.
 *
 * Les montrer ensemble plutôt que d'imposer un bouton « retourner » rend le
 * dilemme visible : les deux images sont là, on n'en jouera qu'une, et l'autre
 * disparaîtra avec la carte.
 */
function HandCard({ card, placed, full, onTapFace }: HandCardProps) {
  const faces = [card.front, card.back];

  return (
    <li
      className={[
        'flex items-center gap-2 rounded-tile bg-white p-2 shadow-tile',
        placed ? 'ring-2 ring-violet' : 'ring-1 ring-ink/5',
      ].join(' ')}
    >
      {faces.map((iconId, index) => {
        const icon = getIcon(iconId);
        if (!icon) return null;

        const isPlaced = placed?.iconId === iconId;
        const inert = full && !placed;

        return (
          <button
            key={`${card.id}-${iconId}-${index}`}
            type="button"
            onClick={() => onTapFace(iconId)}
            aria-pressed={isPlaced}
            aria-label={
              isPlaced
                ? `${icon.label}, posé, appuie pour retirer`
                : `${icon.label}, appuie pour poser`
            }
            className={[
              'flex-1 rounded-tile transition-transform duration-150 active:scale-95',
              inert ? 'opacity-40' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <IconTile
              icon={icon}
              size="sm"
              className="w-full"
              ring={
                isPlaced
                  ? placed.zone === 'green'
                    ? 'ring-4 ring-mint'
                    : 'ring-4 ring-pink'
                  : 'ring-1 ring-ink/5'
              }
            />
          </button>
        );
      })}
    </li>
  );
}
