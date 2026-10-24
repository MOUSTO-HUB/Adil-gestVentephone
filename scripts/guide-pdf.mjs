// Guide d'utilisation en PDF : les fiches Markdown de docs/guide deviennent du HTML,
// imprimé en PDF par Edge ou Chrome sans fenêtre (aucune dépendance à installer).
//
//   node scripts/guide-pdf.mjs
//
// NAVIGATEUR=chemin de msedge.exe ou chrome si le navigateur n'est pas trouvé.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RACINE = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
  '..',
);
const GUIDE = join(RACINE, 'docs', 'guide');
const SORTIE = join(GUIDE, 'pdf');

/** Documents produits : un guide complet, la formation, l'aide-mémoire. */
const DOCUMENTS = [
  {
    nom: 'Guide-GestVente-Phone.pdf',
    titre: 'Guide d’utilisation de GestVente Phone',
    fichiers: [
      'README.md',
      'vendeur/01-vendre.md',
      'vendeur/02-troc.md',
      'vendeur/03-encaisser-une-tranche.md',
      'vendeur/04-caisse.md',
      'vendeur/05-hors-ligne.md',
      'gerant/01-stock.md',
      'gerant/02-inventaire.md',
      'gerant/03-retours.md',
      'gerant/04-transferts.md',
      'gerant/05-credits.md',
      'proprietaire/01-boutiques.md',
      'proprietaire/02-employes.md',
      'proprietaire/03-prix.md',
      'proprietaire/04-rapports.md',
      'proprietaire/05-appareil-perdu.md',
    ],
  },
  {
    nom: 'Formation-vendeurs.pdf',
    titre: 'Formation des vendeurs',
    fichiers: ['formation-vendeurs.md'],
  },
  { nom: 'Aide-memoire.pdf', titre: 'Aide-mémoire du vendeur', fichiers: ['aide-memoire.md'] },
];

const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Ancre d'une fiche dans le document combiné. */
const ancre = (chemin) => `fiche-${chemin.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

/** Gras, italique, code, images et liens d'une ligne. */
function enLigne(texte, fichier) {
  const dossier = dirname(join(GUIDE, fichier));
  return echapper(texte)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
      const url = pathToFileURL(resolve(dossier, src)).href;
      return `<img src="${url}" alt="${alt}">`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, libelle, cible) => {
      if (/^https?:/.test(cible)) return `<a href="${cible}">${libelle}</a>`;
      const chemin = relative(GUIDE, resolve(dossier, cible)).replace(/\\/g, '/');
      return `<a href="#${ancre(chemin)}">${libelle}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\\])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\\\*/g, '*');
}

/** Markdown simple (titres, paragraphes, listes, citations, tableaux, images) → HTML. */
function versHtml(markdown, fichier) {
  const lignes = markdown.replace(/\r/g, '').split('\n');
  const html = [];
  let i = 0;
  const paragraphe = [];
  const vider = () => {
    if (paragraphe.length) html.push(`<p>${enLigne(paragraphe.join(' '), fichier)}</p>`);
    paragraphe.length = 0;
  };
  while (i < lignes.length) {
    const l = lignes[i];
    const titre = /^(#{1,4})\s+(.*)$/.exec(l);
    if (titre) {
      vider();
      const n = titre[1].length;
      html.push(`<h${n}>${enLigne(titre[2], fichier)}</h${n}>`);
      i++;
    } else if (/^\s*\|/.test(l)) {
      vider();
      const rangs = [];
      while (i < lignes.length && /^\s*\|/.test(lignes[i])) rangs.push(lignes[i++]);
      const cellules = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const [entete, , ...corps] = rangs;
      const images = corps.every((r) => cellules(r).every((c) => c.startsWith('![')));
      html.push(
        `<table class="${images ? 'captures' : ''}"><thead><tr>${cellules(entete)
          .map((c) => `<th>${enLigne(c, fichier)}</th>`)
          .join('')}</tr></thead><tbody>${corps
          .map(
            (r) =>
              `<tr>${cellules(r)
                .map((c) => `<td>${enLigne(c, fichier)}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody></table>`,
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      vider();
      const ordonnee = /^\s*\d+\./.test(l);
      const elements = [];
      while (
        i < lignes.length &&
        (/^\s*([-*]|\d+\.)\s+/.test(lignes[i]) || /^\s{2,}\S/.test(lignes[i]))
      ) {
        if (/^\s*([-*]|\d+\.)\s+/.test(lignes[i]))
          elements.push(lignes[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        else elements[elements.length - 1] += ` ${lignes[i].trim()}`;
        i++;
      }
      const balise = ordonnee ? 'ol' : 'ul';
      html.push(
        `<${balise}>${elements
          .map((e) => {
            const case_ = /^\[( |x)\]\s+/.exec(e);
            return case_
              ? `<li class="case">${case_[1] === 'x' ? '☑' : '☐'} ${enLigne(e.slice(case_[0].length), fichier)}</li>`
              : `<li>${enLigne(e, fichier)}</li>`;
          })
          .join('')}</${balise}>`,
      );
    } else if (/^>\s?/.test(l)) {
      vider();
      const bloc = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i]))
        bloc.push(lignes[i++].replace(/^>\s?/, ''));
      html.push(`<blockquote>${enLigne(bloc.join(' '), fichier)}</blockquote>`);
    } else if (/^!\[/.test(l.trim())) {
      vider();
      html.push(`<figure>${enLigne(l.trim(), fichier)}</figure>`);
      i++;
    } else if (!l.trim()) {
      vider();
      i++;
    } else {
      paragraphe.push(l.trim());
      i++;
    }
  }
  vider();
  return html.join('\n');
}

const STYLE = `
@page { size: A4; margin: 16mm 16mm 18mm; }
body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1e2235; line-height: 1.45; }
h1 { color: #283593; font-size: 20pt; border-bottom: 3px solid #f59e0b; padding-bottom: 4px; }
h2 { color: #283593; font-size: 14pt; margin-top: 18px; }
h3 { font-size: 11.5pt; margin-bottom: 4px; }
section.fiche { break-before: page; }
section.fiche:first-of-type { break-before: auto; }
figure { margin: 10px 0; text-align: center; break-inside: avoid; }
img { max-height: 120mm; max-width: 62mm; border: 1px solid #e1e4ee; border-radius: 8px; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; break-inside: avoid; }
th, td { border: 1px solid #e1e4ee; padding: 5px 7px; text-align: left; vertical-align: top; }
th { background: #e8eaf6; }
table.captures, table.captures th, table.captures td { border: none; text-align: center; background: none; }
blockquote { margin: 8px 0; padding: 6px 12px; background: #fef3c7; border-left: 4px solid #f59e0b; }
code { background: #f3f4f8; padding: 1px 4px; border-radius: 4px; }
li.case { list-style: none; margin-left: -18px; }
a { color: #3949ab; text-decoration: none; }
.couverture { text-align: center; padding-top: 70mm; break-after: page; }
.couverture h1 { border: none; font-size: 28pt; }
.couverture p { color: #6b7088; }
`;

function navigateur() {
  const candidats = [
    process.env.NAVIGATEUR,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const trouve = candidats.find((c) => existsSync(c));
  if (!trouve)
    throw new Error('Navigateur introuvable : indiquez NAVIGATEUR=chemin de Edge ou Chrome.');
  return trouve;
}

mkdirSync(SORTIE, { recursive: true });
const executable = navigateur();
const date = new Date().toLocaleDateString('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
for (const doc of DOCUMENTS) {
  const fiches = doc.fichiers
    .map(
      (f) =>
        `<section class="fiche" id="${ancre(f)}">${versHtml(readFileSync(join(GUIDE, f), 'utf8'), f)}</section>`,
    )
    .join('\n');
  const couverture =
    doc.fichiers.length > 1
      ? `<section class="couverture"><h1>${doc.titre}</h1><p>Vendeur · Gérant · Propriétaire</p><p>${date}</p></section>`
      : '';
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${doc.titre}</title><style>${STYLE}</style></head><body>${couverture}${fiches}</body></html>`;
  const fichierHtml = join(SORTIE, `${doc.nom}.html`);
  writeFileSync(fichierHtml, html);
  execFileSync(executable, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${join(SORTIE, doc.nom)}`,
    pathToFileURL(fichierHtml).href,
  ]);
  if (!process.env.GARDER_HTML) rmSync(fichierHtml);
  console.log(`docs/guide/pdf/${doc.nom}`);
}
