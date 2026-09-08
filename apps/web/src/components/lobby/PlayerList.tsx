'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MAX_PLAYERS, type PublicPlayer } from '@identite-secrete/shared';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';

interface PlayerListProps {
  players: PublicPlayer[];
  youId: string;
}

export function PlayerList({ players, youId }: PlayerListProps) {
  const connected = players.filter((player) => player.connected).length;

  return (
    <section aria-labelledby="joueurs-titre">
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          id="joueurs-titre"
          className="font-display text-sm font-extrabold uppercase tracking-widest"
        >
          Joueurs
        </h2>
        <p className="text-sm font-semibold text-muted" aria-live="polite">
          {connected} sur {MAX_PLAYERS} connecté{connected > 1 ? 's' : ''}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {players.map((player) => (
            <motion.li
              key={player.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3 rounded-tile bg-white px-4 py-3 shadow-tile"
            >
              <PlayerAvatar
                playerId={player.id}
                nickname={player.nickname}
                dimmed={!player.connected}
              />

              <span className="min-w-0 flex-1">
                <span
                  className={[
                    'block truncate font-display text-lg font-extrabold',
                    player.connected ? '' : 'text-muted line-through',
                  ].join(' ')}
                >
                  {player.nickname}
                </span>
                {!player.connected ? (
                  <span className="text-xs font-semibold text-muted">
                    Déconnecté·e — la place reste réservée
                  </span>
                ) : null}
              </span>

              {player.id === youId ? (
                <span className="rounded-full bg-violet-light px-2.5 py-1 font-display text-[0.65rem] font-extrabold uppercase tracking-widest text-violet-dark">
                  Toi
                </span>
              ) : null}

              {player.isHost ? (
                <span
                  className="text-xl"
                  role="img"
                  aria-label={`${player.nickname} est l’hôte`}
                >
                  👑
                </span>
              ) : null}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
