import { formaterMontant } from './monnaie.js';
import { LIBELLES_MOYENS, type MoyenPaiement } from './ventes.js';

/**
 * Facture A4 et reçus thermiques d'une vente, construits à partir des mêmes données
 * (base locale de l'appareil : aucun réseau nécessaire pour imprimer).
 */
export interface DocumentVente {
  commerce: string;
  boutique: { nom: string; adresse: string | null; telephone: string | null };
  numero: string;
  dateVente: string;
  statut: 'VALIDEE' | 'ANNULEE';
  client: { nom: string; telephone: string | null } | null;
  lignes: {
    designation: string;
    imei: string | null;
    quantite: number;
    tarif: 'DETAIL' | 'GROS';
    prixUnitaire: number;
    total: number;
    garantieMois: number;
    finGarantie: string | null;
  }[];
  sousTotal: number;
  remise: number;
  /** Valeur des articles rendus déduite (échange). */
  reprise: number;
  total: number;
  montantPaye: number;
  renduMonnaie: number;
  paiements: { moyen: MoyenPaiement; montant: number; reference: string | null }[];
  monnaie: string;
  /** Fuseau du commerce (dates imprimées à l'heure de la boutique). */
  fuseau: string;
}

export type LargeurRecu = 58 | 80;

/** Caractères par ligne d'une imprimante thermique (police A). */
export const COLONNES_RECU: Record<LargeurRecu, number> = { 58: 32, 80: 48 };

export const resteAPayer = (d: Pick<DocumentVente, 'total' | 'montantPaye'>) =>
  Math.max(0, d.total - d.montantPaye);

export function formaterDate(iso: string, fuseau: string, avecHeure = false): string {
  const date = new Date(iso);
  const jour = new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  if (!avecHeure) return jour;
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: fuseau,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${jour} ${heure}`;
}

export type EtatGarantie =
  | { etat: 'SANS' }
  | { etat: 'EN_COURS'; fin: string; joursRestants: number }
  | { etat: 'EXPIREE'; fin: string };

/** Garantie d'un produit vendu à une date donnée (jours restants arrondis au jour entamé). */
export function etatGarantie(finGarantie: string | null, maintenant: Date): EtatGarantie {
  if (!finGarantie) return { etat: 'SANS' };
  const reste = new Date(finGarantie).getTime() - maintenant.getTime();
  if (reste <= 0) return { etat: 'EXPIREE', fin: finGarantie };
  return { etat: 'EN_COURS', fin: finGarantie, joursRestants: Math.ceil(reste / 86_400_000) };
}

/** Mention imprimée sous une ligne : « Garantie 12 mois, jusqu'au 20/10/2027 ». */
export function mentionGarantie(
  ligne: Pick<DocumentVente['lignes'][number], 'garantieMois' | 'finGarantie'>,
  fuseau: string,
): string | null {
  if (!ligne.finGarantie || ligne.garantieMois <= 0) return null;
  return `Garantie ${ligne.garantieMois} mois, jusqu'au ${formaterDate(ligne.finGarantie, fuseau)}`;
}

// ---------------------------------------------------------------- Reçu thermique

export interface LigneRecu {
  texte: string;
  centre?: boolean;
  gras?: boolean;
}

/** Montants imprimés sans espace insécable (imprimantes thermiques). */
const montant = (valeur: number, monnaie: string) =>
  formaterMontant(valeur, monnaie).replace(/\u202f/g, ' ');

/** Coupe un texte en lignes de `largeur` caractères au plus, sur les espaces si possible. */
export function couper(texte: string, largeur: number): string[] {
  const lignes: string[] = [];
  let courante = '';
  for (const mot of texte.split(/\s+/).filter(Boolean)) {
    for (let morceau = mot; morceau;) {
      const place = courante ? largeur - courante.length - 1 : largeur;
      if (morceau.length <= place) {
        courante = courante ? `${courante} ${morceau}` : morceau;
        morceau = '';
      } else if (courante) {
        lignes.push(courante);
        courante = '';
      } else {
        lignes.push(morceau.slice(0, largeur));
        morceau = morceau.slice(largeur);
      }
    }
  }
  if (courante) lignes.push(courante);
  return lignes.length ? lignes : [''];
}

/** « Libellé ........ valeur » sur une ligne (valeur à droite). */
export function colonnes(gauche: string, droite: string, largeur: number): string {
  const espace = largeur - gauche.length - droite.length;
  if (espace >= 1) return gauche + ' '.repeat(espace) + droite;
  return `${gauche.slice(0, Math.max(0, largeur - droite.length - 1))} ${droite}`;
}

/** Contenu du reçu (58 mm : 32 colonnes, 80 mm : 48), commun à l'ESC/POS et au HTML. */
export function lignesRecu(d: DocumentVente, largeur: LargeurRecu): LigneRecu[] {
  const n = COLONNES_RECU[largeur];
  const tiret = { texte: '-'.repeat(n) };
  const centre = (texte: string, gras = false) =>
    couper(texte, n).map((t) => ({ texte: t, centre: true, gras }));
  const r: LigneRecu[] = [
    ...centre(d.commerce.toUpperCase(), true),
    ...centre(d.boutique.nom),
    ...(d.boutique.adresse ? centre(d.boutique.adresse) : []),
    ...(d.boutique.telephone ? centre(`Tél. ${d.boutique.telephone}`) : []),
    tiret,
    { texte: `Reçu ${d.numero}`, gras: true },
    { texte: formaterDate(d.dateVente, d.fuseau, true) },
  ];
  if (d.client) {
    r.push(...couper(`Client : ${d.client.nom}`, n).map((texte) => ({ texte })));
    if (d.client.telephone) r.push({ texte: `Tél. ${d.client.telephone}` });
  }
  if (d.statut === 'ANNULEE') r.push(...centre('*** VENTE ANNULÉE ***', true));
  r.push(tiret);
  for (const l of d.lignes) {
    r.push(...couper(l.designation, n).map((texte) => ({ texte, gras: true })));
    if (l.imei) r.push({ texte: ` IMEI ${l.imei}` });
    r.push({
      texte: colonnes(
        ` ${l.quantite} x ${montant(l.prixUnitaire, '').trim()}${l.tarif === 'GROS' ? ' (gros)' : ''}`,
        montant(l.total, '').trim(),
        n,
      ),
    });
    const garantie = mentionGarantie(l, d.fuseau);
    if (garantie) r.push(...couper(garantie, n - 1).map((t) => ({ texte: ` ${t}` })));
  }
  r.push(tiret);
  if (d.remise > 0 || d.reprise > 0) {
    r.push({ texte: colonnes('Sous-total', montant(d.sousTotal, d.monnaie), n) });
  }
  if (d.remise > 0) r.push({ texte: colonnes('Remise', `-${montant(d.remise, d.monnaie)}`, n) });
  if (d.reprise > 0) {
    r.push({ texte: colonnes('Reprise', `-${montant(d.reprise, d.monnaie)}`, n) });
  }
  r.push({ texte: colonnes('TOTAL', montant(d.total, d.monnaie), n), gras: true });
  for (const p of d.paiements) {
    r.push({ texte: colonnes(LIBELLES_MOYENS[p.moyen], montant(p.montant, d.monnaie), n) });
    if (p.reference) r.push({ texte: ` Réf. ${p.reference}` });
  }
  if (d.renduMonnaie > 0) {
    r.push({ texte: colonnes('Monnaie rendue', montant(d.renduMonnaie, d.monnaie), n) });
  }
  const reste = resteAPayer(d);
  if (reste > 0) {
    r.push({ texte: colonnes('Reste à payer', montant(reste, d.monnaie), n), gras: true });
  }
  r.push(tiret, ...centre('Merci de votre confiance !'));
  if (d.lignes.some((l) => l.finGarantie)) {
    r.push(...centre('Garantie sur présentation de ce reçu.'));
  }
  return r;
}

// ---------------------------------------------------------------- HTML (impression, PDF)

const echapper = (texte: string) =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Reçu en HTML pour une imprimante d'ordinateur réglée sur du papier de 58 ou 80 mm. */
export function recuHtml(d: DocumentVente, largeur: LargeurRecu): string {
  const corps = lignesRecu(d, largeur)
    .map(
      (l) =>
        `<div class="${[l.centre ? 'c' : '', l.gras ? 'g' : ''].join(' ').trim()}">${echapper(l.texte) || '&nbsp;'}</div>`,
    )
    .join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu ${echapper(d.numero)}</title>
<style>
@page { size: ${largeur}mm auto; margin: 2mm; }
body { margin: 0; font-family: 'Courier New', monospace; font-size: ${largeur === 58 ? 9 : 10}pt; color: #000; }
div { white-space: pre; line-height: 1.25; }
.c { text-align: center; } .g { font-weight: bold; }
</style></head><body>
${corps}
</body></html>`;
}

/** Facture A4 (impression classique ou PDF partagé). */
export function factureHtml(d: DocumentVente): string {
  const m = (v: number) => echapper(formaterMontant(v, d.monnaie));
  const lignes = d.lignes
    .map((l) => {
      const details = [
        l.imei ? `IMEI ${echapper(l.imei)}` : '',
        echapper(mentionGarantie(l, d.fuseau) ?? ''),
      ]
        .filter(Boolean)
        .join('<br>');
      return `<tr>
  <td>${echapper(l.designation)}${details ? `<div class="detail">${details}</div>` : ''}</td>
  <td class="n">${l.quantite}</td>
  <td class="n">${m(l.prixUnitaire)}${l.tarif === 'GROS' ? '<div class="detail">prix de gros</div>' : ''}</td>
  <td class="n">${m(l.total)}</td>
</tr>`;
    })
    .join('\n');
  const reste = resteAPayer(d);
  const totaux = [
    d.remise > 0 || d.reprise > 0
      ? `<tr><td>Sous-total</td><td class="n">${m(d.sousTotal)}</td></tr>`
      : '',
    d.remise > 0 ? `<tr><td>Remise</td><td class="n">− ${m(d.remise)}</td></tr>` : '',
    d.reprise > 0
      ? `<tr><td>Reprise (échange ou troc)</td><td class="n">− ${m(d.reprise)}</td></tr>`
      : '',
    `<tr class="total"><td>Total</td><td class="n">${m(d.total)}</td></tr>`,
    ...d.paiements.map(
      (p) =>
        `<tr><td>${echapper(LIBELLES_MOYENS[p.moyen])}${p.reference ? ` (réf. ${echapper(p.reference)})` : ''}</td><td class="n">${m(p.montant)}</td></tr>`,
    ),
    d.renduMonnaie > 0
      ? `<tr><td>Monnaie rendue</td><td class="n">${m(d.renduMonnaie)}</td></tr>`
      : '',
    reste > 0 ? `<tr class="total"><td>Reste à payer</td><td class="n">${m(reste)}</td></tr>` : '',
  ].join('\n');
  const coordonnees = [d.boutique.adresse, d.boutique.telephone && `Tél. ${d.boutique.telephone}`]
    .filter(Boolean)
    .map((t) => echapper(t as string))
    .join('<br>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Facture ${echapper(d.numero)}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 11pt; color: #111; margin: 0; }
header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1d4ed8; padding-bottom: 12px; }
h1 { font-size: 20pt; margin: 0; color: #1d4ed8; }
h2 { font-size: 16pt; margin: 0; text-align: right; }
.discret { color: #555; font-size: 10pt; }
.client { margin: 18px 0; }
table { width: 100%; border-collapse: collapse; }
.lignes th { text-align: left; background: #eef2ff; padding: 8px; font-size: 10pt; }
.lignes td { padding: 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
.n { text-align: right; white-space: nowrap; }
.detail { color: #555; font-size: 9pt; margin-top: 2px; }
.totaux { width: 45%; margin: 16px 0 0 auto; }
.totaux td { padding: 4px 8px; }
.total td { font-weight: bold; font-size: 13pt; border-top: 1px solid #111; }
.annulee { color: #b91c1c; font-weight: bold; font-size: 14pt; margin-top: 12px; }
footer { margin-top: 32px; font-size: 9pt; color: #555; }
/* Lecture à l'écran (lien envoyé au client) : marges, largeur limitée, texte lisible. */
@media screen {
  body { max-width: 820px; margin: 0 auto; padding: 20px 16px; font-size: 15px; }
  .lignes { display: block; overflow-x: auto; }
  .totaux { width: 100%; max-width: 380px; }
}
</style></head><body>
<header>
  <div><h1>${echapper(d.commerce)}</h1><div>${echapper(d.boutique.nom)}</div><div class="discret">${coordonnees}</div></div>
  <div><h2>Facture</h2><div class="discret" style="text-align:right">N° ${echapper(d.numero)}<br>${echapper(formaterDate(d.dateVente, d.fuseau, true))}</div></div>
</header>
${d.statut === 'ANNULEE' ? '<div class="annulee">VENTE ANNULÉE</div>' : ''}
<div class="client"><strong>Client :</strong> ${d.client ? `${echapper(d.client.nom)}${d.client.telephone ? ` · ${echapper(d.client.telephone)}` : ''}` : 'client de passage'}</div>
<table class="lignes">
<thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead>
<tbody>
${lignes}
</tbody>
</table>
<table class="totaux">
${totaux}
</table>
<footer>Garantie valable sur présentation de cette facture, pour les produits et durées indiqués. Merci de votre confiance.</footer>
</body></html>`;
}

/** Résumé de la vente envoyé par WhatsApp ou SMS avec le PDF. */
export function texteMessage(d: DocumentVente): string {
  const lignes = [
    `${d.commerce} – ${d.boutique.nom}`,
    `Facture ${d.numero} du ${formaterDate(d.dateVente, d.fuseau)}`,
    ...d.lignes.map((l) => {
      const garantie = mentionGarantie(l, d.fuseau);
      return `- ${l.quantite} x ${l.designation}${l.imei ? ` (IMEI ${l.imei})` : ''} : ${montant(l.total, d.monnaie)}${garantie ? `. ${garantie}` : ''}`;
    }),
  ];
  if (d.remise > 0) lignes.push(`Remise : -${montant(d.remise, d.monnaie)}`);
  if (d.reprise > 0) lignes.push(`Reprise (échange) : -${montant(d.reprise, d.monnaie)}`);
  lignes.push(`Total : ${montant(d.total, d.monnaie)}`);
  const reste = resteAPayer(d);
  if (reste > 0) lignes.push(`Reste à payer : ${montant(reste, d.monnaie)}`);
  lignes.push('Merci de votre confiance !');
  return lignes.join('\n');
}
