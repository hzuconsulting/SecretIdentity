/**
 * URL du serveur Socket.IO.
 *
 * `NEXT_PUBLIC_SERVER_URL` est inlinée au build par Next : elle doit être
 * définie sur Vercel avant le déploiement, sinon le client tentera de joindre
 * localhost depuis le navigateur des joueurs.
 */
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
