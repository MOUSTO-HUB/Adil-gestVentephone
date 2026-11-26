/**
 * Service worker du site installable : l'application s'ouvre et fonctionne hors ligne
 * (les données sont dans la base SQLite du navigateur). Rien de l'API n'est mis en
 * cache : les réponses du serveur restent privées et toujours fraîches.
 *
 * À la construction, scripts/hors-ligne.cjs inscrit ci-dessous tous les fichiers du site
 * et une version tirée de leur contenu : ils sont téléchargés dès l'installation (pas
 * seulement les pages déjà visitées), et une nouvelle version remplace l'ancienne copie.
 */
const VERSION = 'gestvente-cf875d8106ad';
const FICHIERS = ["/_expo/static/js/web/entry-5bed9faca2e7a35194c00ab6e9fd18a5.js","/_expo/static/js/web/index-9ffdbaa29af3867d61a6db1f393980a1.js","/_expo/static/js/web/worker-379db4c514258725d47054e9615b6428.js","/assets/_node_modules/pnpm/@expo+vector-icons@15.1.1_expo-font@57.0.4_react-native@0.86.3_@babel+core@7.29.7_suppo_f901ce3aeea2fcb0aa405dc4f230b4b4/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.b4eb097d35f44ed943676fd56f6bdc51.ttf","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/arrow_down.017bc6ba3fc25503e5eb5e53826d48a8.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/error.d1ea1496f9057eb392d5bbf3732a61b7.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/file.19eeb73b9593a38f8e9f418337fc7d10.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/forward.d8b800c443b8972542883e0b9de2bdc6.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/pkg.ab19f4cbc543357183a20571f68380a3.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/back-icon-mask.0a328cd9c1afd0afe8e3b1ec5165b1b4.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/back-icon.35ba0eaec5a4f5ed12ca16fabeae451d.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@2x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@3x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/clear-icon.c94f6478e7ae0cdd9f15de1fcb9e5e55@4x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@2x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@3x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/close-icon.808e1b1b9b53114ec2838071a7e6daa7@4x.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/react-navigation/elements/search-icon.286d67d3f74808a60a78d3ebf1a5fb57.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/sitemap.412dd9275b6b48ad28f5e3d81bb1f626.png","/assets/_node_modules/pnpm/expo-router@57.0.28_149d2f6126e1970f30f9e5e2ca11ecdf/node_modules/expo-router/assets/unmatched.20e71bdf79e3a97bf55fd9e164041578.png","/assets/_node_modules/pnpm/expo-sqlite@57.0.4_expo@57.0.30_react-native@0.86.3_@babel+core@7.29.7_supports-color@8_1587363f22dc52a7d1d9445294f10dfc/node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.7ca566fbbc2ec2a172c5aefa63a20f4b.wasm","/favicon.ico","/icones/apple-touch-icon.png","/icones/icone-192.png","/icones/icone-512.png","/icones/icone-maskable-512.png","/index.html","/manifest.json"];
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
