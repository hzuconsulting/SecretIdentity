'use client';

import { MIN_PLAYERS, type PlayerView } from '@identite-secrete/shared';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';

/**
 * Partie en pause.
 *
 * Elle recouvre l'écran de jeu entièrement, et c'est voulu : tant qu'il manque
 * du monde, rien n'est cliquable et le décompte est gelé par le moteur. Laisser
 * l'écran de phase visible derrière donnerait l'impression qu'on peut encore
 * jouer.
 *
 * Le message dit qui manque, parce que c'est l'information dont la table a
 * besoin pour agir : appeler la personne, ou attendre.
 */
export function PausedOverlay({ view }: { view: PlayerView }) {
  const missing = view.players.filter((player) => !player.connected);

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="pause-titre"
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/85 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-card bg-white p-6 text-center shadow-card">
        <p className="text-4xl" aria-hidden="true">
          ⏸️
        </p>
        <h2 id="pause-titre" className="mt-2 font-display text-2xl font-black uppercase">
          Partie en pause
        </h2>
        <p className="mt-2 text-sm font-semibold text-muted">
          {view.pauseReason ??
            `Il faut au moins ${MIN_PLAYERS} joueurs connectés pour continuer.`}
        </p>

        {missing.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {missing.map((player) => (
              <li
                key={player.id}
                className="flex items-center gap-2 rounded-tile bg-lilac px-3 py-2 text-left"
              >
                <PlayerAvatar
                  playerId={player.id}
                  nickname={player.nickname}
                  size="sm"
                  dimmed
                />
                <span className="font-display text-base font-extrabold">
                  {player.nickname}
                </span>
                <span className="ml-auto text-sm font-semibold text-muted">absent·e</span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-4 text-sm font-semibold text-muted">
          La manche reprend dès leur retour, là où elle en était. Sans personne, on
          revient au salon.
        </p>
      </div>
    </div>
  );
}
