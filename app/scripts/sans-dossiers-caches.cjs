/**
 * Après `expo export --platform web` : renomme les dossiers dont le nom commence par
 * un point (ex. `assets/_node_modules/.pnpm`) et corrige leurs chemins dans les fichiers
 * du site. Certains hébergeurs (o2switch) refusent toujours ces chemins (403), ce qui
 * empêchait le chargement de la base locale (wa-sqlite.wasm).
 *
 * Usage : node scripts/sans-dossiers-caches.cjs [dossier]   (par défaut : dist-web)
 */
const fs = require('node:fs');
const path = require('node:path');

const racine = path.resolve(process.argv[2] ?? 'dist-web');
if (!fs.existsSync(path.join(racine, 'index.html'))) {
  console.error(`Pas de site construit dans ${racine} (index.html absent).`);
  process.exit(1);
}

/** Dossiers à point, du plus profond au moins profond (renommage sans casser les chemins). */
function dossiersCaches(dossier, trouves = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const chemin = path.join(dossier, entree.name);
    dossiersCaches(chemin, trouves);
    if (entree.name.startsWith('.')) trouves.push(chemin);
  }
  return trouves;
}

const renommes = new Set();
for (const chemin of dossiersCaches(racine)) {
  const nom = path.basename(chemin);
  const nouveau = path.join(path.dirname(chemin), nom.replace(/^\.+/, ''));
  if (fs.existsSync(nouveau)) {
    console.error(`Impossible de renommer ${chemin} : ${nouveau} existe déjà.`);
    process.exit(1);
  }
  fs.renameSync(chemin, nouveau);
  renommes.add(nom);
}

let fichiers = 0;
function corriger(dossier) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) corriger(chemin);
    else if (/\.(js|html|json|css|map)$/.test(entree.name)) {
      const avant = fs.readFileSync(chemin, 'utf8');
      let apres = avant;
      for (const nom of renommes)
        apres = apres.split(`/${nom}/`).join(`/${nom.replace(/^\.+/, '')}/`);
      if (apres !== avant) {
        fs.writeFileSync(chemin, apres);
        fichiers += 1;
      }
    }
  }
}
if (renommes.size) corriger(racine);

console.log(
  renommes.size
    ? `Dossiers renommés : ${[...renommes].join(', ')} ; fichiers corrigés : ${fichiers}.`
    : 'Aucun dossier à point : rien à faire.',
);
