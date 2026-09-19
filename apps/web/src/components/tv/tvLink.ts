import { BASE_PATH } from '@/lib/config';

/**
 * L'adresse de l'écran de suivi.
 *
 * Un module minuscule et **sans dépendance à React**, parce qu'il est importé
 * des deux côtés de la frontière : par l'écran de suivi lui-même, et par le
 * menu d'une partie en cours, qui propose le lien. Passer par
 * `components/game/GameRoute` pour le nom du paramètre embarquerait tout le
 * client de jeu dans le lot de l'écran de suivi — c'est la raison pour laquelle
 * `OpenGames` recopie déjà la même constante.
 */

/** Le même que `CODE_PARAM` côté partie : court, il finit dans un SMS. */
export const TV_CODE_PARAM = 'c';

/** Chemin interne, pour un `<Link>` ou un `router.push`. */
export function tvPath(code: string): string {
  return `/tv?${TV_CODE_PARAM}=${code.toUpperCase()}`;
}

/**
 * Adresse complète, à taper sur une télé ou à envoyer.
 *
 * `window.location.origin` ne porte pas le préfixe du site : sur GitHub Pages,
 * il faut l'ajouter, sinon le lien tombe à côté. Rendue vide côté serveur —
 * il n'y a pas d'origine à ce moment-là.
 */
export function tvUrl(code: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${BASE_PATH}${tvPath(code)}`;
}
