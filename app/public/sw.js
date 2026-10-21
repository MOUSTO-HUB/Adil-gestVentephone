/**
 * Service worker du site installable : l'application s'ouvre et fonctionne hors ligne
 * (les données sont dans la base SQLite du navigateur). Rien de l'API n'est mis en
 * cache : les réponses du serveur restent privées et toujours fraîches.
 */
const VERSION = 'gestvente-v1';
const COQUILLE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icones/icone-192.png',
  '/icones/icone-512.png',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(COQUILLE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

/** Fichiers au nom unique (empreinte) : servis du cache, téléchargés une seule fois. */
const estStatique = (url) =>
  url.pathname.startsWith('/_expo/') ||
  url.pathname.startsWith('/assets/') ||
  url.pathname.startsWith('/icones/') ||
  /\.(wasm|ttf|woff2?|png|svg|ico)$/.test(url.pathname);

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Pages : le réseau d'abord (nouvelle version), la copie en cache hors ligne.
  if (requete.mode === 'navigate') {
    evenement.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put('/index.html', copie));
          return reponse;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  if (estStatique(url)) {
    evenement.respondWith(
      caches.match(requete).then(
        (enCache) =>
          enCache ||
          fetch(requete).then((reponse) => {
            if (reponse.ok) {
              const copie = reponse.clone();
              caches.open(VERSION).then((cache) => cache.put(requete, copie));
            }
            return reponse;
          }),
      ),
    );
  }
});
