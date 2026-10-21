import { type FrequenceCredit, LIBELLES_FREQUENCES } from './credit.js';
import {
  colonnes,
  COLONNES_RECU,
  couper,
  formaterDate,
  type LargeurRecu,
  type LigneRecu,
} from './documents.js';
import { formaterMontant } from './monnaie.js';
import { LIBELLES_MOYENS, type MoyenRemboursement } from './ventes.js';

/** Contrat de vente à crédit (A4, signé par le client, le garant et le vendeur). */
export interface DocumentCredit {
  commerce: string;
  boutique: { nom: string; adresse: string | null; telephone: string | null };
  numeroVente: string;
  dateVente: string;
  vendeur: string;
  client: { nom: string; telephone: string; piece: string | null; adresse: string | null };
  garant: {
    nom: string;
    telephone: string;
    piece: string | null;
    adresse: string | null;
    lien: string | null;
  } | null;
  lignes: { designation: string; imei: string | null; quantite: number; total: number }[];
  /** Prix après remise et reprise. */
  total: number;
  apport: number;
  montantFinance: number;
  frequence: FrequenceCredit;
  echeances: { numero: number; date: string; montant: number }[];
  monnaie: string;
  fuseau: string;
}

/** Reçu d'un encaissement de tranche, avec le solde restant. */
export interface RecuEncaissement {
  commerce: string;
  boutique: { nom: string; adresse: string | null; telephone: string | null };
  numeroVente: string;
  client: string;
  date: string;
  montant: number;
  moyen: MoyenRemboursement;
  reference: string | null;
  /** Reste dû après cet encaissement. */
  restant: number;
  prochaine: { date: string; reste: number } | null;
  encaissePar: string;
  monnaie: string;
  fuseau: string;
}

const echapper = (texte: string) =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const montant = (v: number, monnaie: string) => formaterMontant(v, monnaie).replace(/[  ]/g, ' ');
/** Jour AAAA-MM-JJ → JJ/MM/AAAA. */
export const jourFr = (jour: string) => jour.split('-').reverse().join('/');

export function lignesRecuEncaissement(r: RecuEncaissement, largeur: LargeurRecu): LigneRecu[] {
  const n = COLONNES_RECU[largeur];
  const tiret = { texte: '-'.repeat(n) };
  const centre = (texte: string, gras = false) =>
    couper(texte, n).map((t) => ({ texte: t, centre: true, gras }));
  return [
    ...centre(r.commerce.toUpperCase(), true),
    ...centre(r.boutique.nom),
    ...(r.boutique.telephone ? centre(`Tél. ${r.boutique.telephone}`) : []),
    tiret,
    ...centre('REÇU DE TRANCHE', true),
    { texte: formaterDate(r.date, r.fuseau, true) },
    ...couper(`Client : ${r.client}`, n).map((texte) => ({ texte })),
    { texte: `Crédit de la vente ${r.numeroVente}` },
    tiret,
    { texte: colonnes('Versé', montant(r.montant, r.monnaie), n), gras: true },
    { texte: colonnes(LIBELLES_MOYENS[r.moyen], r.reference ? `Réf. ${r.reference}` : '', n) },
    { texte: colonnes('Reste dû', montant(r.restant, r.monnaie), n), gras: true },
    ...(r.prochaine
      ? [
          { texte: `Prochaine tranche le ${jourFr(r.prochaine.date)}` },
          { texte: colonnes('', montant(r.prochaine.reste, r.monnaie), n) },
        ]
      : r.restant <= 0
        ? centre('*** CRÉDIT SOLDÉ ***', true)
        : []),
    tiret,
    ...couper(`Encaissé par ${r.encaissePar}`, n).map((texte) => ({ texte })),
    ...centre('Merci de votre confiance !'),
  ];
}

export function recuEncaissementHtml(r: RecuEncaissement, largeur: LargeurRecu): string {
  const corps = lignesRecuEncaissement(r, largeur)
    .map(
      (l) =>
        `<div class="${[l.centre ? 'c' : '', l.gras ? 'g' : ''].join(' ').trim()}">${echapper(l.texte) || '&nbsp;'}</div>`,
    )
    .join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu de tranche</title>
<style>
@page { size: ${largeur}mm auto; margin: 2mm; }
body { margin: 0; font-family: 'Courier New', monospace; font-size: ${largeur === 58 ? 9 : 10}pt; color: #000; }
div { white-space: pre; line-height: 1.25; }
.c { text-align: center; } .g { font-weight: bold; }
</style></head><body>
${corps}
</body></html>`;
}

/** Contrat de vente à crédit, à imprimer en deux exemplaires et à signer. */
export function contratCreditHtml(d: DocumentCredit): string {
  const m = (v: number) => echapper(formaterMontant(v, d.monnaie));
  const personne = (
    titre: string,
    p: { nom: string; telephone: string; piece: string | null; adresse: string | null },
    extra = '',
  ) => `<div class="bloc"><div class="titre">${titre}</div>
<div><strong>${echapper(p.nom)}</strong>${extra}</div>
<div>Tél. ${echapper(p.telephone)}</div>
${p.piece ? `<div>Pièce : ${echapper(p.piece)}</div>` : ''}
${p.adresse ? `<div>${echapper(p.adresse)}</div>` : ''}</div>`;
  const articles = d.lignes
    .map(
      (l) =>
        `<tr><td>${echapper(l.designation)}${l.imei ? `<div class="detail">IMEI ${echapper(l.imei)}</div>` : ''}</td><td class="n">${l.quantite}</td><td class="n">${m(l.total)}</td></tr>`,
    )
    .join('\n');
  const tranches = d.echeances
    .map(
      (e) =>
        `<tr><td>${e.numero}</td><td>${echapper(jourFr(e.date))}</td><td class="n">${m(e.montant)}</td><td></td></tr>`,
    )
    .join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Contrat de crédit ${echapper(d.numeroVente)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #111; margin: 0; }
header { border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; display: flex; justify-content: space-between; }
h1 { font-size: 17pt; margin: 0; color: #1d4ed8; }
h2 { font-size: 12pt; margin: 18px 0 6px; }
.discret { color: #555; font-size: 9.5pt; }
.parties { display: flex; gap: 16px; margin-top: 12px; }
.bloc { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 8px; }
.titre { font-size: 9pt; color: #1d4ed8; text-transform: uppercase; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; }
th { background: #eef2ff; text-align: left; padding: 6px; font-size: 9.5pt; }
td { padding: 5px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
.n { text-align: right; white-space: nowrap; }
.detail { color: #555; font-size: 9pt; }
.resume td { border: none; padding: 3px 6px; }
.resume .fort td { font-weight: bold; border-top: 1px solid #111; }
.clauses li { margin-bottom: 4px; }
.signatures { display: flex; gap: 16px; margin-top: 24px; }
.signatures div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 9.5pt; height: 60px; }
</style></head><body>
<header>
  <div><h1>${echapper(d.commerce)}</h1><div>${echapper(d.boutique.nom)}</div><div class="discret">${[
    d.boutique.adresse,
    d.boutique.telephone && `Tél. ${d.boutique.telephone}`,
  ]
    .filter(Boolean)
    .map((t) => echapper(t as string))
    .join(' · ')}</div></div>
  <div style="text-align:right"><strong>Contrat de vente à crédit</strong><div class="discret">Facture ${echapper(d.numeroVente)}<br>${echapper(formaterDate(d.dateVente, d.fuseau, true))}</div></div>
</header>
<div class="parties">
${personne('Client', d.client)}
${d.garant ? personne('Garant', d.garant, d.garant.lien ? ` (${echapper(d.garant.lien)})` : '') : ''}
</div>
<h2>Articles</h2>
<table><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Montant</th></tr></thead><tbody>
${articles}
</tbody></table>
<table class="resume" style="width:50%;margin:10px 0 0 auto">
<tr><td>Prix total</td><td class="n">${m(d.total)}</td></tr>
<tr><td>Apport versé ce jour</td><td class="n">${m(d.apport)}</td></tr>
<tr class="fort"><td>Reste à rembourser</td><td class="n">${m(d.montantFinance)}</td></tr>
</table>
<h2>Échéancier · ${d.echeances.length} tranche(s), ${echapper(LIBELLES_FREQUENCES[d.frequence].toLowerCase())}</h2>
<table><thead><tr><th>N°</th><th>Date</th><th class="n">Montant</th><th>Payé le / visa</th></tr></thead><tbody>
${tranches}
</tbody></table>
<h2>Conditions</h2>
<ol class="clauses">
<li>Le client s'engage à payer chaque tranche au plus tard à la date indiquée, en boutique ou par Orange Money / MTN MoMo (avec référence).</li>
<li>Chaque versement donne lieu à un reçu indiquant le solde restant ; un versement partiel est imputé sur la tranche la plus ancienne.</li>
<li>Un rappel est envoyé par SMS ou WhatsApp avant chaque échéance et en cas de retard ; une pénalité de retard peut s'appliquer selon les conditions de la boutique.</li>
<li>${d.garant ? 'Le garant s’engage à payer les sommes dues si le client ne le fait pas.' : 'Le client reste seul responsable des sommes dues.'}</li>
<li>La garantie des articles s'applique dans les conditions de la facture.</li>
</ol>
<p class="discret">Fait en deux exemplaires, le ${echapper(formaterDate(d.dateVente, d.fuseau))}. Vendeur : ${echapper(d.vendeur)}.</p>
<div class="signatures">
  <div>Le client<br><span class="discret">« Lu et approuvé »</span></div>
  ${d.garant ? '<div>Le garant<br><span class="discret">« Lu et approuvé »</span></div>' : ''}
  <div>Pour la boutique</div>
</div>
</body></html>`;
}
