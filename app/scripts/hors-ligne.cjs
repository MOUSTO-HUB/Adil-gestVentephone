/**
 * Après `expo export --platform web` (et sans-dossiers-caches.cjs) : inscrit dans sw.js
 * la liste de tous les fichiers du site et une version calculée sur leur contenu. Le
 * service worker les télécharge dès son installation : l'application installée (PC ou
 * téléphone) s'ouvre ensuite hors ligne, même si l'utilisateur n'a visité qu'une page.
 * À chaque nouvelle construction, sw.js change : le navigateur installe la nouvelle
 * version et efface l'ancienne copie.
 *
 * Usage : node scripts/hors-ligne.cjs [dossier]   (par défaut : dist-web)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const racine = path.resolve(process.argv[2] ?? 'dist-web');
const sw = path.join(racine, 'sw.js');
if (!fs.existsSync(sw)) {
  console.error(`Pas de sw.js dans ${racine}.`);
  process.exit(1);
}

/** Fichiers propres à chaque publication ou au serveur : jamais mis en cache. */
const EXCLUS = /^(sw\.js|metadata\.json|version\.json|version-source\.txt|\.htaccess)$|\.map$/;

function fichiers(dossier, trouves = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) fichiers(chemin, trouves);
    else trouves.push(chemin);
  }
  return trouves;
}

const empreinte = crypto.createHash('sha256');
const liste = [];
for (const chemin of fichiers(racine).sort()) {
  const relatif = path.relative(racine, chemin).split(path.sep).join('/');
  if (EXCLUS.test(relatif)) continue;
  empreinte.update(relatif).update(fs.readFileSync(chemin));
  liste.push(`/${relatif}`);
}
const version = `gestvente-${empreinte.digest('hex').slice(0, 12)}`;

let texte = fs.readFileSync(sw, 'utf8');
const marqueVersion = /const VERSION = '[^']*';/;
const marqueFichiers = /const FICHIERS = \[[^\]]*\];/;
if (!marqueVersion.test(texte) || !marqueFichiers.test(texte)) {
  console.error('sw.js : marqueurs VERSION ou FICHIERS introuvables.');
  process.exit(1);
}
texte = texte
  .replace(marqueVersion, `const VERSION = '${version}';`)
  .replace(marqueFichiers, `const FICHIERS = ${JSON.stringify(liste)};`);
fs.writeFileSync(sw, texte);
console.log(`Hors ligne : ${liste.length} fichiers dans sw.js (${version}).`);
