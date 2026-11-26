/**
 * Service worker du site installable : l'application s'ouvre et fonctionne hors ligne
 * (les données sont dans la base SQLite du navigateur). Rien de l'API n'est mis en
 * cache : les réponses du serveur restent privées et toujours fraîches.
 *
 * À la construction, scripts/hors-ligne.cjs inscrit ci-dessous tous les fichiers du site
 * et une version tirée de leur contenu : ils sont téléchargés dès l'installation (pas
 * seulement les pages déjà visitées), et une nouvelle version remplace l'ancienne copie.
 */
const VERSION = 'gestvente-dev';
const FICHIERS = [];
const COQUILLE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icones/icone-192.png',
  '/icones/icone-512.png',
];
/** Connexion trop lente : au-delà, la page s'ouvre depuis la copie de l'appareil. */
const DELAI_RESEAU_MS = 5000;

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches
      .open(VERSION)
      // Tout ou rien : une copie incomplète ne remplace jamais une copie qui marche.
      .then((cache) => cache.addAll([...new Set([...COQUILLE, ...FICHIERS])]))
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

/** Page : le réseau d'abord (nouvelle version) ; hors ligne ou trop lent, la copie. */
function page(requete) {
  const reseau = fetch(requete).then((reponse) => {
    if (reponse.ok) {
      const copie = reponse.clone();
      caches.open(VERSION).then((cache) => cache.put('/index.html', copie));
    }
    return reponse;
  });
  const copie = () => caches.match('/index.html');
  const lent = new Promise((resoudre) => setTimeout(resoudre, DELAI_RESEAU_MS)).then(copie);
  return Promise.race([reseau, lent.then((r) => r || reseau)]).catch(() =>
    copie().then((r) => r || Response.error()),
  );
}

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Version publiée : toujours demandée au serveur (bandeau « Nouvelle version »).
  if (url.pathname === '/version.json') return;

  if (requete.mode === 'navigate') {
    evenement.respondWith(page(requete));
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
