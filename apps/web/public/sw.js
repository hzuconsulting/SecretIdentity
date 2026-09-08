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
 *  - il ne touche **jamais** au trafic Socket.IO. Une partie est un flux temps
 *    réel : la mettre en cache n'aurait aucun sens et casserait le jeu ;
 *  - il sert le réseau en priorité pour les pages, et ne retombe sur le cache
 *    que si le réseau échoue. Une version périmée de l'interface face à un
 *    serveur à jour serait pire qu'une page d'erreur.
 */

const VERSION = 'identite-secrete-v1';
const SHELL = `${VERSION}-shell`;

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

  // Tout ce qui n'est pas notre origine — au premier chef le serveur de jeu —
  // passe sans être touché.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/socket.io/')) return;

  // Pages : réseau d'abord, cache en secours.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
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
