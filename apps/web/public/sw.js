/*
 * Service worker d'Identité Secrète.
 *
 * Écrit à la main plutôt que généré : le besoin tient en vingt lignes, et une
 * dépendance de plus aurait ajouté une étape de build pour un résultat moins
 * lisible.
 *
 * Ce qu'il fait, et surtout ce qu'il ne fait pas :
 *  - il met en cache la coquille de l'application, pour que l'écran d'accueil
 *    s'ouvre instantanément et hors ligne ;
 *  - il ne touche **jamais** au trafic de jeu. Les parties passent par WebRTC,
 *    qui ne traverse pas `fetch` — il n'y a donc rien à exclure, et rien à
 *    mettre en cache : ce sont des flux temps réel entre deux téléphones ;
 *  - il laisse passer le service de mise en relation, servi par une autre
 *    origine, sans y toucher ;
 *  - il garde les **portraits** des personnages dans un cache à part et borné,
 *    pour qu'un personnage déjà vu garde son visage hors ligne ;
 *  - il sert le réseau en priorité pour les pages, et ne retombe sur le cache
 *    que si le réseau échoue. Une version périmée de l'interface face à des
 *    joueurs à jour serait pire qu'une page d'erreur.
 */

// Incrémenté à chaque correctif qui doit absolument atteindre les appareils
// déjà installés : `activate` supprime tout cache dont la clé ne commence pas
// par cette valeur.
const VERSION = 'identite-secrete-v4';
const SHELL = `${VERSION}-shell`;

/**
 * Portraits des personnages : `portraits/<id>.<empreinte>.webp`.
 *
 * Cache à part, **borné** : un plateau montre huit personnages par manche, et
 * le catalogue en compte près de mille. Sans limite, les soirées de jeu
 * finiraient par tout copier sur le téléphone. Au-delà de la limite, les plus
 * anciens sortent en premier.
 *
 * Le nom porte l'empreinte du contenu : une photo changée change d'adresse. On
 * peut donc servir le cache d'abord sans jamais montrer une photo périmée.
 */
const PORTRAITS = `${VERSION}-portraits`;
const PORTRAIT_LIMIT = 300;

function isPortrait(url) {
  return /\/portraits\/[a-z0-9-]+\.[0-9a-f]{10}\.webp$/.test(url.pathname);
}

async function servePortrait(request) {
  const cache = await caches.open(PORTRAITS);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    void trimPortraits(cache);
  }
  return response;
}

async function trimPortraits(cache) {
  // `keys()` rend les entrées dans l'ordre d'insertion : les plus anciennes d'abord.
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - PORTRAIT_LIMIT))) {
    await cache.delete(key);
  }
}

self.addEventListener('install', (event) => {
  // On prend la main tout de suite : une mise à jour ne doit pas attendre la
  // fermeture de tous les onglets.
  self.skipWaiting();

  event.waitUntil(
    caches.open(SHELL).then((cache) =>
      cache.addAll(['./', './manifest.webmanifest', './icons/icon-192.png']).catch(() => {
        // Un fichier absent ne doit pas empêcher l'installation.
      }),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Tout ce qui n'est pas notre origine — au premier chef le service de mise en
  // relation — passe sans être touché.
  if (url.origin !== self.location.origin) return;

  if (isPortrait(url)) {
    event.respondWith(servePortrait(request));
    return;
  }

  // Pages, et la liste des portraits — qui garde la même adresse d'une version
  // à l'autre : réseau d'abord, cache en secours.
  if (request.mode === 'navigate' || url.pathname.endsWith('/portraits.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            // Une page inconnue retombe sur l'accueil ; la liste des portraits,
            // elle, échoue franchement — l'écran montrera les initiales.
            .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./') : Response.error())),
        ),
    );
    return;
  }

  // Ressources versionnées (JS, CSS, images) : cache d'abord, c'est immuable.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
