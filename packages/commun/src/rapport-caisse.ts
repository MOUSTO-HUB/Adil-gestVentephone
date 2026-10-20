import { type Montants, totalMontants } from './caisse.js';
import {
  colonnes,
  COLONNES_RECU,
  couper,
  formaterDate,
  type LargeurRecu,
  type LigneRecu,
} from './documents.js';
import { formaterMontant } from './monnaie.js';
import { LIBELLES_MOYENS, MOYENS_REMBOURSEMENT } from './ventes.js';

/** Rapport de clôture d'une session de caisse (ticket 80 mm ou PDF). */
export interface RapportCaisse {
  commerce: string;
  boutique: string;
  vendeur: string;
  statut: 'OUVERTE' | 'CLOTUREE' | 'VALIDEE';
  ouverteLe: string;
  clotureeLe: string | null;
  fondInitial: number;
  nombreVentes: number;
  encaisse: Montants;
  rembourse: Montants;
  depense: Montants;
  theorique: Montants;
  comptage: Montants | null;
  ecarts: Montants | null;
  ecartTotal: number | null;
  commentaire: string | null;
  validePar: string | null;
  commentaireValidation: string | null;
  monnaie: string;
  fuseau: string;
}

const m = (v: number, monnaie: string) => formaterMontant(v, monnaie).replace(/\u202f/g, ' ');
const signe = (v: number, monnaie: string) => (v > 0 ? `+${m(v, monnaie)}` : m(v, monnaie));

export function lignesRapportCaisse(r: RapportCaisse, largeur: LargeurRecu = 80): LigneRecu[] {
  const n = COLONNES_RECU[largeur];
  const tiret = { texte: '-'.repeat(n) };
  const ligne = (g: string, d: string, gras = false) => ({ texte: colonnes(g, d, n), gras });
  const l: LigneRecu[] = [
    ...couper(r.commerce.toUpperCase(), n).map((texte) => ({ texte, centre: true, gras: true })),
    ...couper(r.boutique, n).map((texte) => ({ texte, centre: true })),
    tiret,
    { texte: 'CLÔTURE DE CAISSE', centre: true, gras: true },
    ...couper(`Vendeur : ${r.vendeur}`, n).map((texte) => ({ texte })),
    { texte: `Ouverte : ${formaterDate(r.ouverteLe, r.fuseau, true)}` },
    ...(r.clotureeLe
      ? [{ texte: `Clôturée : ${formaterDate(r.clotureeLe, r.fuseau, true)}` }]
      : []),
    tiret,
    ligne('Fond de caisse', m(r.fondInitial, r.monnaie)),
    ligne('Ventes', String(r.nombreVentes)),
  ];
  for (const k of MOYENS_REMBOURSEMENT) {
    if (!r.encaisse[k] && !r.rembourse[k] && !r.depense[k] && !r.theorique[k] && !r.comptage?.[k]) {
      continue;
    }
    l.push(tiret, { texte: LIBELLES_MOYENS[k].toUpperCase(), gras: true });
    if (r.encaisse[k]) l.push(ligne(' Encaissé', m(r.encaisse[k], r.monnaie)));
    if (r.rembourse[k]) l.push(ligne(' Remboursé', `-${m(r.rembourse[k], r.monnaie)}`));
    if (r.depense[k]) l.push(ligne(' Dépenses', `-${m(r.depense[k], r.monnaie)}`));
    l.push(ligne(' Attendu', m(r.theorique[k], r.monnaie)));
    if (r.comptage) l.push(ligne(' Compté', m(r.comptage[k], r.monnaie)));
    if (r.ecarts) l.push(ligne(' Écart', signe(r.ecarts[k], r.monnaie), r.ecarts[k] !== 0));
  }
  l.push(tiret, ligne('Total attendu', m(totalMontants(r.theorique), r.monnaie), true));
  if (r.comptage) l.push(ligne('Total compté', m(totalMontants(r.comptage), r.monnaie), true));
  if (r.ecartTotal !== null) l.push(ligne('ÉCART', signe(r.ecartTotal, r.monnaie), true));
  if (r.commentaire)
    l.push(...couper(`Commentaire : ${r.commentaire}`, n).map((texte) => ({ texte })));
  l.push(tiret);
  l.push({
    texte:
      r.statut === 'VALIDEE'
        ? `Validée par ${r.validePar ?? '—'}`
        : r.statut === 'CLOTUREE'
          ? 'En attente de validation'
          : 'Caisse ouverte',
    centre: true,
  });
  if (r.commentaireValidation) {
    l.push(...couper(r.commentaireValidation, n).map((texte) => ({ texte, centre: true })));
  }
  return l;
}

const echapper = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rapport A4 (PDF ou impression classique). */
export function rapportCaisseHtml(r: RapportCaisse): string {
  const f = (v: number) => echapper(formaterMontant(v, r.monnaie));
  const lignes = MOYENS_REMBOURSEMENT.map(
    (k) => `<tr><td>${echapper(LIBELLES_MOYENS[k])}</td><td class="n">${f(r.encaisse[k])}</td>
<td class="n">${f(r.rembourse[k])}</td><td class="n">${f(r.depense[k])}</td>
<td class="n">${f(r.theorique[k])}</td><td class="n">${r.comptage ? f(r.comptage[k]) : '—'}</td>
<td class="n${r.ecarts && r.ecarts[k] !== 0 ? ' ecart' : ''}">${r.ecarts ? f(r.ecarts[k]) : '—'}</td></tr>`,
  ).join('\n');
  const statut =
    r.statut === 'VALIDEE'
      ? `Validée par ${echapper(r.validePar ?? '—')}`
      : r.statut === 'CLOTUREE'
        ? 'Clôturée, en attente de validation'
        : 'Ouverte';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Clôture de caisse</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
h1 { font-size: 18pt; color: #1d4ed8; margin: 0 0 4px; }
.discret { color: #555; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; }
th { background: #eef2ff; text-align: left; padding: 6px; font-size: 10pt; }
td { padding: 6px; border-bottom: 1px solid #ddd; }
.n { text-align: right; white-space: nowrap; }
.ecart { color: #b91c1c; font-weight: bold; }
.total td { font-weight: bold; border-top: 2px solid #111; }
</style></head><body>
<h1>Clôture de caisse</h1>
<div>${echapper(r.commerce)} · ${echapper(r.boutique)}</div>
<div class="discret">Vendeur : ${echapper(r.vendeur)} · ouverte le ${echapper(formaterDate(r.ouverteLe, r.fuseau, true))}${r.clotureeLe ? ` · clôturée le ${echapper(formaterDate(r.clotureeLe, r.fuseau, true))}` : ''}</div>
<div class="discret">Fond de caisse : ${f(r.fondInitial)} · ${r.nombreVentes} vente(s) · ${statut}</div>
<table>
<thead><tr><th>Moyen</th><th class="n">Encaissé</th><th class="n">Remboursé</th><th class="n">Dépenses</th><th class="n">Attendu</th><th class="n">Compté</th><th class="n">Écart</th></tr></thead>
<tbody>
${lignes}
<tr class="total"><td>Total</td><td></td><td></td><td></td><td class="n">${f(totalMontants(r.theorique))}</td>
<td class="n">${r.comptage ? f(totalMontants(r.comptage)) : '—'}</td><td class="n">${r.ecartTotal === null ? '—' : f(r.ecartTotal)}</td></tr>
</tbody></table>
${r.commentaire ? `<p><strong>Commentaire :</strong> ${echapper(r.commentaire)}</p>` : ''}
${r.commentaireValidation ? `<p><strong>Validation :</strong> ${echapper(r.commentaireValidation)}</p>` : ''}
</body></html>`;
}
