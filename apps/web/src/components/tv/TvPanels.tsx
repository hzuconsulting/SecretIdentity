'use client';

import {
  getIcon,
  getIdentity,
  type IdentityId,
  type Phase,
  type PublicPlayer,
  type RoundReveal,
  type RoundScoreLine,
  type ShownPicto,
  type SpectatorCase,
  type SpectatorView,
} from '@identite-secrete/shared';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { Portrait } from '@/components/game/Portrait';

/**
 * Les panneaux de l'écran de suivi.
 *
 * Ils ne réutilisent volontairement **pas** les écrans de phase : ceux-ci sont
 * dessinés pour une colonne de 28 rem tenue à bout de bras, celui-ci pour une
 * pièce entière. Ce qui est partagé, c'est ce qui doit l'être — les portraits,
 * les avatars, les couleurs des zones — et pas la mise en page, qui n'a aucune
 * raison d'être la même.
 *
 * Aucun de ces panneaux ne reçoit d'action : il n'y a rien à toucher sur une
 * télé, et le moteur refuserait de toute façon une action venant d'un canal
 * sans joueur attaché.
 */

// ─────────────────────────────────────────────────────────────
//  Le plateau
// ─────────────────────────────────────────────────────────────

/**
 * Les huit personnages, numérotés — ce que la table a sous les yeux.
 *
 * C'est le panneau le plus utile au spectateur : sans la liste des noms en face
 * des numéros, aucune des autres informations n'a de sens.
 */
export function TvBoard({ board, compact = false }: { board: IdentityId[]; compact?: boolean }) {
  return (
    <section aria-labelledby="tv-plateau" className="tv-portrait flex min-h-0 flex-col gap-3">
      <h2 id="tv-plateau" className="tv-label font-display font-extrabold uppercase text-white/55">
        Les {board.length} personnages
      </h2>

      <ul
        className={[
          'grid gap-2 sm:gap-3',
          compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4',
        ].join(' ')}
      >
        {board.map((identityId, index) => {
          const slot = index + 1;
          const name = getIdentity(identityId)?.name ?? identityId;

          return (
            <li
              key={`${slot}-${identityId}`}
              className="flex items-center gap-2 rounded-tile bg-white/[0.07] px-2.5 py-2 ring-1 ring-white/10 sm:gap-3 sm:px-3 sm:py-2.5"
            >
              <span
                className="tv-value flex aspect-square w-[2.2em] shrink-0 items-center justify-center rounded-full bg-violet font-display font-black tabular-nums text-white"
                aria-hidden="true"
              >
                {slot}
              </span>
              <Portrait identityId={identityId} name={name} px="var(--tv-portrait)" onDark />
              <span className="tv-body min-w-0 flex-1 hyphens-auto break-words font-display font-extrabold leading-tight">
                <span className="sr-only">Numéro {slot} : </span>
                {name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Les boîtiers
// ─────────────────────────────────────────────────────────────

const ZONE = {
  green: { ring: 'ring-mint', sign: '✓', label: 'représentatif' },
  red: { ring: 'ring-pink', sign: '✗', label: 'pas représentatif' },
} as const;

function TvPicto({ picto }: { picto: ShownPicto }) {
  const icon = getIcon(picto.iconId);
  if (!icon) return null;

  const zone = ZONE[picto.zone];

  return (
    <span
      className={`relative inline-flex aspect-square w-[2.4em] items-center justify-center rounded-tile bg-white ring-4 ${zone.ring}`}
      role="img"
      aria-label={`${icon.label} — ${zone.label}`}
    >
      <span aria-hidden="true" className="text-[1.5em] leading-none">
        {icon.icon}
      </span>
    </span>
  );
}

/**
 * Où en est chacun, et ce qu'il a posé.
 *
 * `placed` arrive **vide** pendant la pose : le moteur ne l'envoie pas, et ce
 * n'est pas un oubli d'affichage (voir `spectatorView.ts`). L'écran montre
 * alors la seule chose publique à ce moment-là — qui a validé.
 */
export function TvCases({ cases, waitingLabel }: { cases: SpectatorCase[]; waitingLabel: string }) {
  return (
    <section aria-labelledby="tv-boitiers" className="flex min-h-0 flex-col gap-3">
      <h2 id="tv-boitiers" className="tv-label font-display font-extrabold uppercase text-white/55">
        Les boîtiers
      </h2>

      <ul className="grid gap-2 sm:gap-3 xl:grid-cols-2">
        {cases.map((entry) => (
          <li
            key={entry.playerId}
            className="flex flex-col gap-2 rounded-tile bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10"
          >
            <div className="flex items-center gap-2">
              <PlayerAvatar playerId={entry.playerId} nickname={entry.nickname} size="sm" />
              <span className="tv-body min-w-0 flex-1 truncate font-display font-extrabold">
                {entry.nickname}
              </span>
              <span
                className={[
                  'tv-label shrink-0 rounded-full px-2.5 py-1 font-display font-extrabold uppercase',
                  entry.submitted ? 'bg-mint/20 text-mint' : 'bg-white/10 text-white/60',
                ].join(' ')}
              >
                {entry.submitted ? '✓ Validé' : waitingLabel}
              </span>
            </div>

            {entry.placed.length > 0 ? (
              <ul className="tv-body flex flex-wrap gap-2">
                {entry.placed.map((picto, index) => (
                  <li key={`${picto.iconId}-${index}`}>
                    <TvPicto picto={picto} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  La révélation
// ─────────────────────────────────────────────────────────────

/**
 * Fin de manche : qui était qui, et qui l'a trouvé.
 *
 * Le titre reste dans le document mais disparaît de l'écran : l'en-tête dit
 * déjà « Révélation », en très grand, à trente centimètres au-dessus. L'écrire
 * deux fois ferait perdre une ligne à ce qu'on est venu lire, sans rien
 * apprendre — alors qu'un lecteur d'écran, lui, a besoin de la section nommée.
 */
export function TvReveals({ reveals }: { reveals: RoundReveal[] }) {
  return (
    <section aria-labelledby="tv-revelation" className="tv-portrait flex min-h-0 flex-col gap-3">
      <h2 id="tv-revelation" className="sr-only">
        Révélation
      </h2>

      <ul className="grid gap-2 sm:gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {reveals.map((reveal) => {
          const name = getIdentity(reveal.identityId)?.name ?? reveal.identityId;
          const found = reveal.guessedByPlayerIds.length;

          return (
            <li
              key={reveal.playerId}
              className="flex flex-col gap-2 rounded-tile bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <Portrait identityId={reveal.identityId} name={name} px="var(--tv-portrait)" onDark />
                <div className="min-w-0 flex-1">
                  <p className="tv-value break-words font-display font-extrabold leading-tight">
                    <span className="text-violet-light">n°{reveal.slot}</span> {name}
                  </p>
                  <p className="tv-body mt-0.5 flex items-center gap-1.5 font-semibold text-white/60">
                    <PlayerAvatar
                      playerId={reveal.playerId}
                      nickname={reveal.nickname}
                      size="xs"
                    />
                    <span className="min-w-0 truncate">C’était {reveal.nickname}</span>
                  </p>
                </div>
              </div>

              {reveal.placed.length > 0 ? (
                <ul className="tv-body flex flex-wrap gap-2">
                  {reveal.placed.map((picto, index) => (
                    <li key={`${picto.iconId}-${index}`}>
                      <TvPicto picto={picto} />
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="tv-label font-display font-extrabold uppercase text-sun">
                {found} sur {reveal.possibleGuessers} {found > 1 ? 'ont' : 'a'} trouvé
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
//  Le classement
// ─────────────────────────────────────────────────────────────

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Le classement, en grand.
 *
 * `podium` met les trois premiers en avant : c'est l'écran de fin de partie,
 * où le classement **est** le contenu, pas un rappel dans un coin.
 */
export function TvStandings({
  standings,
  podium = false,
  showLabel = true,
}: {
  standings: RoundScoreLine[];
  podium?: boolean;
  /** `false` quand l'en-tête dit déjà « Classement ». Le titre reste lisible au clavier. */
  showLabel?: boolean;
}) {
  return (
    <section aria-labelledby="tv-classement" className="flex min-h-0 flex-col gap-3">
      <h2
        id="tv-classement"
        className={
          showLabel
            ? 'tv-label font-display font-extrabold uppercase text-white/55'
            : 'sr-only'
        }
      >
        Classement
      </h2>

      <ol className="flex flex-col gap-2">
        {standings.map((line, index) => (
          <li
            key={line.playerId}
            className={[
              'flex items-center gap-3 rounded-tile px-3 py-2 ring-1',
              podium && index === 0
                ? 'bg-sun/20 ring-sun/40'
                : 'bg-white/[0.07] ring-white/10',
            ].join(' ')}
          >
            <span className="tv-value w-[1.8em] shrink-0 text-center" aria-hidden="true">
              {MEDALS[index] ?? index + 1}
            </span>
            <PlayerAvatar playerId={line.playerId} nickname={line.nickname} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="tv-value block truncate font-display font-extrabold">
                {line.nickname}
              </span>
              <span className="tv-label font-semibold text-white/50">
                {line.cardsLeft} carte{line.cardsLeft > 1 ? 's' : ''} en main
              </span>
            </span>
            <span className="tv-title shrink-0 font-display font-black tabular-nums">
              {line.cumulative}
            </span>
          </li>
        ))}
      </ol>

      {podium ? (
        <p className="tv-label font-semibold text-white/45">
          À égalité de points, c’est le joueur ayant gardé le plus de cartes Picto qui
          l’emporte.
        </p>
      ) : null}
    </section>
  );
}

/** Les trois statistiques de fin de partie. */
export function TvStats({ stats }: { stats: NonNullable<SpectatorView['stats']> }) {
  const lines: Array<{ label: string; value: string }> = [];

  if (stats.bestDetective) {
    lines.push({
      label: 'Meilleur détective',
      value: `${stats.bestDetective.nickname} · ${stats.bestDetective.correctGuesses} trouvé${
        stats.bestDetective.correctGuesses > 1 ? 's' : ''
      }`,
    });
  }
  if (stats.bestCluegiver) {
    lines.push({
      label: 'Meilleur créateur de pictos',
      value: `${stats.bestCluegiver.nickname} · ${Math.round(
        stats.bestCluegiver.successRate * 100,
      )} % de réussite`,
    });
  }
  if (stats.hardestIdentity) {
    lines.push({
      label: 'Indice incompris',
      value: `${stats.hardestIdentity.nickname} · ${Math.round(
        stats.hardestIdentity.successRate * 100,
      )} % de réussite`,
    });
  }

  if (lines.length === 0) return null;

  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {lines.map((line) => (
        <li key={line.label} className="rounded-tile bg-white/[0.07] px-3 py-2 ring-1 ring-white/10">
          <p className="tv-label font-display font-extrabold uppercase text-white/50">
            {line.label}
          </p>
          <p className="tv-body break-words font-display font-extrabold">{line.value}</p>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────
//  Le bandeau des joueurs
// ─────────────────────────────────────────────────────────────

/**
 * Le score de chacun, en bas de l'écran, à toutes les phases.
 *
 * C'est la seule chose qui ne bouge jamais de place : on lève les yeux vers la
 * télé pour savoir où en est le score, et on doit le trouver au même endroit
 * quelle que soit la phase. Les joueurs sont dans l'ordre du salon, pas du
 * classement — un bandeau qui se réordonne à chaque manche oblige à relire.
 */
export function TvPlayersStrip({
  players,
  phase,
  cases,
}: {
  players: PublicPlayer[];
  phase: Phase;
  cases?: SpectatorCase[];
}) {
  const submitted = new Map(cases?.map((entry) => [entry.playerId, entry.submitted]) ?? []);

  /**
   * L'état d'un joueur, en un mot. `null` quand il n'y a rien à en dire.
   *
   * Un seul est affiché, le plus important d'abord : absent ou déconnecté prime
   * sur « a validé », qui ne veut plus dire grand-chose pour quelqu'un qui n'est
   * plus là. Le compte de cartes se tait au salon — les mains sont distribuées
   * au lancement, et « 0 cartes » s'y lirait comme une main vide.
   */
  function stateOf(player: PublicPlayer): string | null {
    if (player.away) return 'Parti';
    if (!player.connected) return 'Hors ligne';

    const done = submitted.get(player.id);
    if (done === true) return '✓ Validé';
    if (done === false) return 'En cours…';

    if (player.isHost) return 'Hôte';
    return phase === 'LOBBY' ? null : `${player.cardsLeft} cartes`;
  }

  return (
    <section aria-label="Les joueurs" className="border-t border-white/10 bg-black/25 px-4 py-2.5">
      <ul className="flex flex-wrap items-stretch justify-center gap-2 sm:gap-3">
        {players.map((player) => {
          const state = stateOf(player);

          return (
            <li
              key={player.id}
              className={[
                'flex min-w-0 items-center gap-2 rounded-tile px-2.5 py-1.5 ring-1',
                player.connected
                  ? 'bg-white/[0.07] ring-white/10'
                  : 'bg-white/[0.03] ring-white/5 opacity-50',
              ].join(' ')}
            >
              <PlayerAvatar
                playerId={player.id}
                nickname={player.nickname}
                size="sm"
                dimmed={!player.connected}
              />
              <span className="min-w-0">
                <span className="tv-body block max-w-[9ch] truncate font-display font-extrabold">
                  {player.nickname}
                </span>
                {state ? (
                  <span className="tv-label block font-semibold uppercase text-white/50">
                    {state}
                  </span>
                ) : null}
              </span>
              <span className="tv-value shrink-0 pl-1 font-display font-black tabular-nums">
                {player.score}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
