/**
 * Aléa cryptographique, portable.
 *
 * `node:crypto` n'existe pas dans un navigateur, et `Math.random` ne convient
 * pas ici : un `sessionToken` devinable permettrait d'usurper la session d'un
 * autre joueur, donc de lire son identité secrète. `globalThis.crypto` est
 * disponible côté navigateur (contexte sécurisé : https ou localhost) comme
 * côté Node ≥ 19, et c'est le même algorithme des deux côtés.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function webCrypto(): Crypto {
  const available = globalThis.crypto;
  if (!available || typeof available.getRandomValues !== 'function') {
    throw new Error(
      "crypto.getRandomValues est indisponible. Le jeu doit être servi en https ou depuis localhost.",
    );
  }
  return available;
}

/** Jeton opaque de 32 caractères, tiré de 24 octets aléatoires. */
export function createSessionToken(): string {
  const bytes = new Uint8Array(24);
  webCrypto().getRandomValues(bytes);

  let token = '';
  for (const byte of bytes) {
    // 64 symboles : chaque octet est réduit modulo 64, sans biais notable pour
    // un usage d'identifiant.
    token += ALPHABET[byte % ALPHABET.length];
  }
  return token;
}

/** Identifiant unique de joueur. */
export function createId(): string {
  const available = webCrypto();
  if (typeof available.randomUUID === 'function') return available.randomUUID();

  // Repli pour les rares environnements sans `randomUUID` : même source d'aléa.
  const bytes = new Uint8Array(16);
  available.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Empreinte SHA-256, en hexadécimal.
 *
 * Sert à publier un **engagement** sur un jeton de session sans publier le
 * jeton : l'instantané de relais porte l'empreinte, le joueur présente le
 * jeton, et le nouvel hôte vérifie la correspondance. Il peut ainsi reconnaître
 * tout le monde sans jamais avoir eu de quoi usurper personne.
 *
 * Asynchrone parce que `crypto.subtle` l'est — c'est la même API des deux
 * côtés, navigateur en contexte sécurisé et Node ≥ 19, exactement comme
 * `getRandomValues` ci-dessus.
 */
export async function sha256Hex(input: string): Promise<string> {
  const subtle = webCrypto().subtle;
  if (!subtle) {
    throw new Error(
      'crypto.subtle est indisponible. Le jeu doit être servi en https ou depuis localhost.',
    );
  }

  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
