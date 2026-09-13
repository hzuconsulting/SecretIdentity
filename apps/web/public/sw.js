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
 *  - une seule exception aux autres origines : les **vignettes de portraits**
 *    de Wikimedia Commons, gardées dans un cache à part et borné, pour qu'un
 *    personnage déjà vu garde son visage hors ligne ;
 *  - il sert le réseau en priorité pour les pages, et ne retombe sur le cache
 *    que si le réseau échoue. Une version périmée de l'interface face à des
 *    joueurs à jour serait pire qu'une page d'erreur.
 */

// Incrémenté à chaque correctif qui doit absolument atteindre les appareils
// déjà installés : `activate` supprime tout cache dont la clé ne commence pas
// par cette valeur.
const VERSION = 'identite-secrete-v3';
const SHELL = `${VERSION}-shell`;

/**
 * Portraits des personnages : vignettes Wikimedia Commons.
 *
 * Cache à part, **borné** : un plateau montre huit personnages par manche, et
 * le catalogue en compte plus de mille. Sans limite, des soirées de jeu
 * finiraient par occuper des dizaines de mégaoctets sur le téléphone. Au-delà
 * de la limite, les plus anciens sortent en premier.
 */
const PORTRAITS = `${VERSION}-portraits`;
const PORTRAIT_LIMIT = 300;

function isPortrait(url) {
  return (
    url.hostname === 'upload.wikimedia.org' &&
    url.pathname.startsWith('/wikipedia/commons/thumb/')
  );
}

async function servePortrait(request) {
  const cache = await caches.open(PORTRAITS);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);

  // Seules les réponses CORS réussies entrent : l'image est demandée avec
  // `crossorigin`, et Wikimedia répond `Access-Control-Allow-Origin: *`. Une
  // réponse opaque (statut 0) cacherait une erreur et coûterait jusqu'à ~7 Mo
  // de quota chacune dans Chrome.
  if (response.ok && response.type === 'cors') {
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

  // Portraits : cache d'abord — une vignette Commons ne change pas d'adresse
  // sans changer de contenu.
  if (isPortrait(url)) {
    event.respondWith(servePortrait(request));
    return;
  }

  // Tout le reste qui n'est pas notre origine — au premier chef le service de
  // mise en relation — passe sans être touché.
  if (url.origin !== self.location.origin) return;

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
