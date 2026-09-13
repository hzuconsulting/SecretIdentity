import { CHAT_HISTORY_SIZE, type ChatMessage, type Game, type PlayerId } from '@identite-secrete/shared';
import { createId } from '../random';
import { touch } from './factory';

/**
 * La discussion de la partie.
 *
 * L'hôte ne garde que les `CHAT_HISTORY_SIZE` derniers messages : ils partent
 * dans chaque vue, et une vue doit tenir dans un seul message réseau. Ce qui
 * sort de la fenêtre est oublié — c'est une conversation, pas des archives.
 */

export interface ChatAuthor {
  playerId: PlayerId;
  nickname: string;
}

export function appendChatMessage(
  game: Game,
  author: ChatAuthor,
  text: string,
  now: number,
): ChatMessage {
  const message: ChatMessage = {
    id: createId(),
    playerId: author.playerId,
    // Copié maintenant : un joueur qui part ou qui est exclu signe toujours
    // ce qu'il a écrit.
    nickname: author.nickname,
    text,
    sentAt: now,
  };

  game.chat.push(message);
  if (game.chat.length > CHAT_HISTORY_SIZE) {
    game.chat.splice(0, game.chat.length - CHAT_HISTORY_SIZE);
  }

  // Une table qui discute est une table vivante : la purge des parties
  // inactives ne doit pas la fermer sous ses doigts.
  touch(game, now);

  return message;
}
