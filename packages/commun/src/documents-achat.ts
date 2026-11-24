import { formaterMontant } from './monnaie.js';
import { LIBELLES_MOYENS, type MoyenPaiement } from './ventes.js';

/**
 * Bon de commande fournisseur (A4) : imprimé, enregistré en PDF ou partagé par WhatsApp,
 * construit à partir de la base locale (aucun réseau nécessaire).
 */
export interface DocumentBonCommande {
  commerce: string;
  boutique: { nom: string; adresse: string | null; telephone: string | null };
  numero: string;
  /** Date du bon (AAAA-MM-JJ). */
  dateAchat: string;
  statut: 'BROUILLON' | 'PARTIEL' | 'RECU' | 'ANNULE';
  fournisseur: { nom: string; telephone: string | null; adresse: string | null };
  lignes: {
    designation: string;
    quantite: number;
    quantiteRecue: number;
    prixAchat: number;
    total: number;
  }[];
  total: number;
  montantPaye: number;
  paiements: { date: string; montant: number; moyen: string; reference: string | null }[];
  note: string | null;
  /** Nom de la personne qui imprime le bon. */
  emisPar: string | null;
  monnaie: string;
}

export const LIBELLES_ETAT_BON: Record<DocumentBonCommande['statut'], string> = {
  BROUILLON: 'En attente de réception',
  PARTIEL: 'Reçu en partie',
  RECU: 'Reçu',
  ANNULE: 'Annulé',
};

const echapper = (texte: string) =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Montants sans espace insécable fine (messages, imprimantes). */
const montantSimple = (v: number, monnaie: string) =>
  formaterMontant(v, monnaie).replace(/ /g, ' ');

/** « 2026-11-24 » ou « 2026-11-24T10:00:00Z » → « 24/11/2026 ». */
const jour = (date: string) => date.slice(0, 10).split('-').reverse().join('/');

const libelleMoyen = (moyen: string) => LIBELLES_MOYENS[moyen as MoyenPaiement] ?? moyen;

export const resteBon = (d: Pick<DocumentBonCommande, 'total' | 'montantPaye'>) =>
  Math.max(0, d.total - d.montantPaye);

/** Bon de commande A4 (impression, « Enregistrer en PDF », partage du PDF). */
export function bonCommandeHtml(d: DocumentBonCommande): string {
  const m = (v: number) => echapper(formaterMontant(v, d.monnaie));
  const lignes = d.lignes
    .map(
      (l, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td>${echapper(l.designation)}${l.quantiteRecue > 0 ? `<div class="detail">Reçu : ${l.quantiteRecue} / ${l.quantite}</div>` : ''}</td>
  <td class="n">${l.quantite}</td>
  <td class="n">${m(l.prixAchat)}</td>
  <td class="n">${m(l.total)}</td>
</tr>`,
    )
    .join('\n');
  const reste = resteBon(d);
  const totaux = [
    `<tr class="total"><td>Total</td><td class="n">${m(d.total)}</td></tr>`,
    ...d.paiements.map(
      (p) =>
        `<tr><td>Payé le ${echapper(jour(p.date))} · ${echapper(libelleMoyen(p.moyen))}${p.reference ? ` (réf. ${echapper(p.reference)})` : ''}</td><td class="n">${m(p.montant)}</td></tr>`,
    ),
    d.montantPaye > 0 && !d.paiements.length
      ? `<tr><td>Déjà payé</td><td class="n">${m(d.montantPaye)}</td></tr>`
      : '',
    `<tr class="total"><td>Reste à payer</td><td class="n">${m(reste)}</td></tr>`,
  ].join('\n');
  const coordonnees = [d.boutique.adresse, d.boutique.telephone && `Tél. ${d.boutique.telephone}`]
    .filter(Boolean)
    .map((t) => echapper(t as string))
    .join('<br>');
  const fournisseur = [
    `<strong>${echapper(d.fournisseur.nom)}</strong>`,
    d.fournisseur.adresse ? echapper(d.fournisseur.adresse) : '',
    d.fournisseur.telephone ? `Tél. ${echapper(d.fournisseur.telephone)}` : '',
  ]
    .filter(Boolean)
    .join('<br>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bon de commande ${echapper(d.numero)}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; }
h1 { font-size: 20pt; margin: 0; color: #1d4ed8; }
h2 { font-size: 16pt; margin: 0; text-align: right; }
.discret { color: #555; font-size: 10pt; }
.parties { display: flex; justify-content: space-between; gap: 24px; margin: 18px 0; }
.parties > div { flex: 1; border: 1px solid #ddd; border-radius: 6px; padding: 10px; }
.titre { font-size: 9pt; text-transform: uppercase; color: #555; margin-bottom: 4px; }
table { width: 100%; border-collapse: collapse; }
.lignes th { text-align: left; background: #eef2ff; padding: 8px; font-size: 10pt; }
.lignes td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
.n { text-align: right; white-space: nowrap; }
.detail { color: #555; font-size: 9pt; margin-top: 2px; }
.totaux { width: 55%; margin: 16px 0 0 auto; }
.totaux td { padding: 4px 8px; }
.total td { font-weight: bold; font-size: 12pt; border-top: 1px solid #111; }
.annule { color: #b91c1c; font-weight: bold; font-size: 14pt; margin-top: 12px; }
.note { margin-top: 16px; }
.signatures { display: flex; justify-content: space-between; margin-top: 48px; font-size: 10pt; }
.signatures div { width: 40%; border-top: 1px solid #111; padding-top: 4px; text-align: center; }
@media screen {
  body { max-width: 820px; margin: 0 auto; padding: 20px 16px; font-size: 15px; }
  .parties { flex-direction: column; }
  .totaux { width: 100%; max-width: 420px; }
}
</style></head><body>
<header>
  <div><h1>${echapper(d.commerce)}</h1><div>${echapper(d.boutique.nom)}</div><div class="discret">${coordonnees}</div></div>
  <div><h2>Bon de commande</h2><div class="discret" style="text-align:right">N° ${echapper(d.numero)}<br>Du ${echapper(jour(d.dateAchat))}<br>${echapper(LIBELLES_ETAT_BON[d.statut])}</div></div>
</header>
${d.statut === 'ANNULE' ? '<div class="annule">BON ANNULÉ</div>' : ''}
<div class="parties">
  <div><div class="titre">Fournisseur</div>${fournisseur}</div>
  <div><div class="titre">Commandé par</div><strong>${echapper(d.boutique.nom)}</strong>${d.emisPar ? `<br>${echapper(d.emisPar)}` : ''}</div>
</div>
<table class="lignes">
<thead><tr><th class="n">N°</th><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead>
<tbody>
${lignes}
</tbody>
</table>
<table class="totaux">
${totaux}
</table>
${d.note ? `<div class="note"><strong>Note :</strong> ${echapper(d.note)}</div>` : ''}
<div class="signatures"><div>Le fournisseur</div><div>La boutique</div></div>
</body></html>`;
}

/** Résumé du bon envoyé par WhatsApp. */
export function texteBonCommande(d: DocumentBonCommande): string {
  const lignes = [
    `${d.commerce} – ${d.boutique.nom}`,
    `Bon de commande ${d.numero} du ${jour(d.dateAchat)}`,
    `Fournisseur : ${d.fournisseur.nom}`,
    ...d.lignes.map(
      (l) =>
        `- ${l.quantite} x ${l.designation} à ${montantSimple(l.prixAchat, d.monnaie)} : ${montantSimple(l.total, d.monnaie)}`,
    ),
    `Total : ${montantSimple(d.total, d.monnaie)}`,
  ];
  if (d.montantPaye > 0) lignes.push(`Déjà payé : ${montantSimple(d.montantPaye, d.monnaie)}`);
  const reste = resteBon(d);
  if (reste > 0) lignes.push(`Reste à payer : ${montantSimple(reste, d.monnaie)}`);
  if (d.note) lignes.push(`Note : ${d.note}`);
  return lignes.join('\n');
}
