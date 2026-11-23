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
const crypto = require('node:crypto');

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

/** Fichiers texte du site (où l'on corrige les chemins et les noms). */
function fichiersTexte(dossier, trouves = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) fichiersTexte(chemin, trouves);
    else if (/.(js|html|json|css|map)$/.test(entree.name)) trouves.push(chemin);
  }
  return trouves;
}

/** Remplace des morceaux de texte dans tous les fichiers ; rend les fichiers modifiés. */
function remplacer(fichiers, remplacements) {
  const modifies = [];
  for (const chemin of fichiers) {
    const avant = fs.readFileSync(chemin, 'utf8');
    let apres = avant;
    for (const [ancien, nouveau] of remplacements) apres = apres.split(ancien).join(nouveau);
    if (apres !== avant) {
      fs.writeFileSync(chemin, apres);
      modifies.push(chemin);
    }
  }
  return modifies;
}

let fichiers = 0;
if (renommes.size) {
  const textes = fichiersTexte(racine);
  const modifies = remplacer(
    textes,
    [...renommes].map((nom) => [`/${nom}/`, `/${nom.replace(/^\.+/, '')}/`]),
  );
  fichiers = modifies.length;
  // Un fichier modifié garde sinon son nom à empreinte (ex. worker-0585….js) : le navigateur
  // resservirait l'ancienne version de son cache. Nouvelle empreinte, et renvois mis à jour.
  const noms = [];
  for (const chemin of modifies) {
    const ancien = path.basename(chemin);
    const empreinte = /-([0-9a-f]{16,})\.js$/.exec(ancien);
    if (!empreinte) continue;
    const contenu = fs.readFileSync(chemin);
    const nouvelle = crypto.createHash('md5').update(contenu).digest('hex');
    const nouveau = ancien.replace(empreinte[1], nouvelle);
    fs.renameSync(chemin, path.join(path.dirname(chemin), nouveau));
    noms.push([ancien, nouveau]);
  }
  if (noms.length) remplacer(fichiersTexte(racine), noms);
}

console.log(
  renommes.size
    ? `Dossiers renommés : ${[...renommes].join(', ')} ; fichiers corrigés : ${fichiers}.`
    : 'Aucun dossier à point : rien à faire.',
);
