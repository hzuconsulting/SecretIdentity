'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  TIMER_URGENT_SECONDS,
  formatCountdown,
  formatDifficulty,
  secondsRemaining,
  type Phase,
  type SpectatorView,
} from '@identite-secrete/shared';
import { useServerClock } from '@/hooks/useServerClock';
import { useSpectatorConnection, type SpectatorStatus } from '@/hooks/useSpectatorConnection';
import {
  TvBoard,
  TvCases,
  TvPlayersStrip,
  TvReveals,
  TvStandings,
  TvStats,
} from './TvPanels';

/**
 * L'écran de suivi d'une partie — la télé du salon (D-95).
 *
 * Il n'a qu'un travail : dire **où en est la partie**, assez gros pour être lu
 * de l'autre bout de la pièce par quelqu'un qui ne joue pas. Le score, le temps
 * restant, la manche, les personnages du plateau.
 *
 * Trois choix de forme méritent d'être dits, parce qu'ils ne sont pas ceux du
 * reste du site :
 *
 *  - **Fond sombre.** Tout le jeu est en lilas clair, pensé pour un téléphone
 *    dans une pièce éclairée. Une télé, un vidéoprojecteur, un grand écran dans
 *    un salon en soirée : un aplat clair de 50 pouces éblouit, et se voit sur
 *    les murs. C'est aussi ce qui distingue immédiatement l'écran de suivi d'un
 *    écran de joueur — personne ne doit croire qu'il peut y jouer.
 *  - **Aucune action.** Pas de bouton, pas de menu, rien à toucher : cet écran
 *    est regardé, pas manipulé, et souvent hors de portée de la main.
 *  - **Aucun son.** Les téléphones sonnent déjà les changements de phase ; une
 *    télé qui sonnerait en léger décalage ne ferait qu'un écho.
 */

const PHASE_TITLES: Record<Phase, string> = {
  LOBBY: 'Salon',
  IDENTITY_REVEAL: 'Cartes Mystère',
  CLUE_SELECTION: 'Chacun pose ses pictos',
  GUESSING: 'On vote',
  RESULTS: 'Révélation',
  SCOREBOARD: 'Classement',
  FINAL_RESULTS: 'Fin de partie',
};

/**
 * Les phases qui ont un minuteur.
 *
 * Ailleurs, la place du décompte reste vide : le salon et la révélation
 * n'attendent rien d'autre que l'hôte, et y afficher « ♾️ · sans limite »
 * laisserait croire à un réglage alors qu'il n'y a simplement pas d'échéance.
 */
const TIMED_PHASES = new Set<Phase>(['IDENTITY_REVEAL', 'CLUE_SELECTION', 'GUESSING']);

export function TvScreen({ code }: { code: string }) {
  const { status, view, error } = useSpectatorConnection(code);

  if (!view) {
    return <TvMessage status={status} code={code} detail={error?.message ?? null} />;
  }

  return (
    <main className="flex min-h-dvh flex-col bg-ink text-white">
      <TvHeader view={view} />

      {/*
        `m-auto` plutôt que `justify-center` : quand le contenu tient dans la
        hauteur — un plateau de huit cartes sur une télé — il se centre ; quand
        il déborde — une révélation à huit joueurs — les marges automatiques
        retombent à zéro et rien n'est rogné en haut.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6">
        <div className="m-auto w-full">
          <TvPhase view={view} />
        </div>

        {view.paused ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/90 px-6 text-center backdrop-blur-sm">
            <p className="tv-hero" aria-hidden="true">
              ⏸️
            </p>
            <p className="tv-title font-display font-black uppercase">Partie en pause</p>
            <p className="tv-body max-w-[40ch] font-semibold text-white/60">
              {view.pauseReason}
            </p>
          </div>
        ) : null}
      </div>

      <TvPlayersStrip players={view.players} phase={view.phase} cases={view.cases} />

      {/*
        La bannière de liaison passe par-dessus le reste : une télé restée
        allumée pendant que l'hôte change de pièce doit dire pourquoi elle ne
        bouge plus, sans effacer le dernier état connu — qui reste juste.
      */}
      {status === 'lost' || status === 'host-gone' ? (
        <p
          role="status"
          className="tv-body fixed inset-x-0 bottom-0 z-10 bg-pink px-4 py-2 text-center font-display font-extrabold"
        >
          {status === 'host-gone'
            ? 'La partie est fermée — l’hôte a quitté.'
            : 'Liaison perdue avec l’hôte… reconnexion en cours.'}
        </p>
      ) : null}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
//  En-tête
// ─────────────────────────────────────────────────────────────

function TvHeader({ view }: { view: SpectatorView }) {
  const inGame = view.phase !== 'LOBBY';

  return (
    /*
      Trois colonnes de poids égal plutôt qu'un `justify-between` : la phase doit
      rester au milieu de l'écran **même quand la colonne du décompte est vide**,
      ce qui arrive au salon et à la révélation. Avec `justify-between`, un
      troisième enfant absent — ou large de zéro — décalait le titre vers la
      droite d'un demi-code.
    */
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6">
      <div className="flex flex-1 basis-0 items-baseline gap-3">
        <span className="tv-label font-display font-extrabold uppercase text-white/45">
          Code
        </span>
        <span className="tv-title font-display font-black tracking-[0.18em]">{view.code}</span>
      </div>

      <div className="min-w-0 text-center">
        <p className="tv-label font-display font-extrabold uppercase text-white/45">
          {inGame ? `Manche ${view.roundNumber} / ${view.totalRounds}` : 'En attente du lancement'}
        </p>
        <p className="tv-title font-display font-black uppercase">
          {PHASE_TITLES[view.phase]}
        </p>
      </div>

      <div className="flex flex-1 basis-0 justify-end">
        {TIMED_PHASES.has(view.phase) ? <TvTimer phaseEndsAt={view.phaseEndsAt} /> : null}
      </div>
    </header>
  );
}

/**
 * Le décompte, en grand.
 *
 * Il affiche, il ne décide de rien — comme celui des joueurs (§4.2) : arrivé à
 * `00:00`, il y reste jusqu'à ce que le moteur envoie la phase suivante.
 * L'horloge de l'hôte est corrigée du décalage mesuré, sans quoi une télé dont
 * l'heure système est fausse afficherait un décompte différent de celui des
 * téléphones, juste à côté.
 */
function TvTimer({ phaseEndsAt }: { phaseEndsAt: number | null }) {
  const { serverNow } = useServerClock();
  const [remaining, setRemaining] = useState<number | null>(() =>
    secondsRemaining(phaseEndsAt, serverNow()),
  );

  useEffect(() => {
    if (phaseEndsAt === null) {
      setRemaining(null);
      return;
    }

    const tick = () => setRemaining(secondsRemaining(phaseEndsAt, serverNow()));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [phaseEndsAt, serverNow]);

  if (remaining === null) {
    return (
      <p className="tv-value font-display font-black text-white/45" aria-hidden="true">
        ♾️
      </p>
    );
  }

  const urgent = remaining <= TIMER_URGENT_SECONDS;

  return (
    <p
      className={[
        'tv-title font-display font-black tabular-nums',
        urgent ? 'text-pink motion-safe:animate-pulse' : '',
      ].join(' ')}
    >
      <span className="sr-only">Temps restant : </span>
      {formatCountdown(remaining)}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────
//  Contenu, phase par phase
// ─────────────────────────────────────────────────────────────

function TvPhase({ view }: { view: SpectatorView }) {
  switch (view.phase) {
    case 'LOBBY':
      return <TvLobby view={view} />;

    case 'IDENTITY_REVEAL':
      return (
        <div className="flex flex-col gap-3">
          <p className="tv-body font-semibold text-white/55">
            Chacun découvre son numéro sur son téléphone. Personne ne sait qui porte lequel.
          </p>
          {view.board ? <TvBoard board={view.board} /> : null}
        </div>
      );

    case 'CLUE_SELECTION':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {view.board ? <TvBoard board={view.board} compact /> : null}
          {view.cases ? <TvCases cases={view.cases} waitingLabel="Choisit…" /> : null}
        </div>
      );

    case 'GUESSING':
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {view.board ? <TvBoard board={view.board} compact /> : null}
          {view.cases ? <TvCases cases={view.cases} waitingLabel="Vote…" /> : null}
        </div>
      );

    case 'RESULTS':
      return view.reveals ? <TvReveals reveals={view.reveals} /> : null;

    case 'SCOREBOARD':
      return view.standings ? (
        <TvStandings standings={view.standings} showLabel={false} />
      ) : null;

    case 'FINAL_RESULTS':
      return <TvFinal view={view} />;

    default:
      return null;
  }
}

/** Le salon : le code en grand, c'est tout ce qu'on vient y chercher. */
function TvLobby({ view }: { view: SpectatorView }) {
  const waiting = view.players.length;

  return (
    <div className="flex flex-col items-center justify-center gap-5 text-center">
      <p className="tv-label font-display font-extrabold uppercase text-white/45">
        Rejoignez la partie avec ce code
      </p>

      <p className="flex justify-center gap-2 sm:gap-3" aria-label={`Code ${view.code.split('').join(' ')}`}>
        {view.code.split('').map((char, index) => (
          <span
            key={`${char}-${index}`}
            className="tv-hero flex aspect-[3/4] w-[1.1em] items-center justify-center rounded-tile bg-white font-display font-black text-ink"
            aria-hidden="true"
          >
            {char}
          </span>
        ))}
      </p>

      <p className="tv-value font-display font-extrabold">
        {waiting} joueur{waiting > 1 ? 's' : ''} dans le salon
      </p>
      <p className="tv-body font-semibold text-white/50">
        {view.totalRounds} manches · Personnages : {formatDifficulty(view.settings.difficulty)}
      </p>
    </div>
  );
}

function TvFinal({ view }: { view: SpectatorView }) {
  return (
    <div className="flex flex-col gap-4">
      {view.standings ? <TvStandings standings={view.standings} podium /> : null}
      {view.stats ? <TvStats stats={view.stats} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Avant la première vue
// ─────────────────────────────────────────────────────────────

/**
 * L'écran d'attente, de refus ou d'échec.
 *
 * Il n'apparaît que **tant qu'aucune vue n'est arrivée** : une fois la partie
 * affichée, une coupure ne l'efface plus — elle se dit par une bannière, et le
 * dernier état connu reste à l'écran. Vider une télé parce que le Wi-Fi a
 * hoqueté serait le pire moment pour le faire.
 */
function TvMessage({
  status,
  code,
  detail,
}: {
  status: SpectatorStatus;
  code: string;
  detail: string | null;
}) {
  const refused = status === 'refused' || status === 'host-gone';

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ink px-6 text-center text-white">
      <p className="tv-hero" aria-hidden="true">
        {refused ? '📺' : '⏳'}
      </p>
      <h1 className="tv-title font-display font-black uppercase">
        {refused ? 'Aucune partie à suivre' : 'Connexion à la partie…'}
      </h1>
      <p className="tv-body max-w-[46ch] font-semibold text-white/60">
        {detail ??
          (refused
            ? `Personne n’héberge la partie ${code}. Vérifie le code, et que l’hôte a bien gardé son onglet ouvert.`
            : `On cherche la partie ${code}.`)}
      </p>
      <Link
        href="/tv"
        className="tv-body min-h-[48px] rounded-tile bg-white/10 px-6 py-3 font-display font-extrabold uppercase tracking-wide ring-1 ring-white/20"
      >
        Changer de code
      </Link>
    </main>
  );
}
