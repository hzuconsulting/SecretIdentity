/**
 * Préfixe d'URL du site.
 *
 * Vide sur un domaine dédié (Vercel, domaine perso). Sur GitHub Pages, le site
 * vit dans un sous-dossier au nom du dépôt : `/identite-secrete`. Le manifeste,
 * le service worker et les liens de partage doivent en tenir compte.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * URL du serveur Socket.IO.
 *
 * `NEXT_PUBLIC_SERVER_URL` est inlinée au build par Next : elle doit être
 * définie sur Vercel avant le déploiement, sinon le client tentera de joindre
 * localhost depuis le navigateur des joueurs.
 */
export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';
