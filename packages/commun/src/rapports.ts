/**
 * Rapports de la boutique : chiffre d'affaires et bénéfice brut par période, vendeur
 * et produit ; stock dormant et valeur du stock. Calculés par le serveur, et par
 * l'appareil sur ses données locales quand il est hors ligne.
 */

export type Regroupement = 'jour' | 'semaine' | 'mois';

/** Vente validée, telle que la lit le calcul (montants entiers). */
export interface VenteRapport {
  date: string;
  vendeurId: string;
  sousTotal: number;
  remise: number;
  lignes: { produitId: string; quantite: number; total: number; prixAchat: number }[];
}

/** Retour : valeur rendue et coût des articles revenus en stock (le rebut est perdu). */
export interface RetourRapport {
  date: string;
  vendeurId: string;
  lignes: {
    produitId: string;
    quantite: number;
    montant: number;
    coutUnitaire: number;
    destination: 'REMISE_EN_STOCK' | 'OCCASION' | 'REBUT';
  }[];
}

export interface Chiffres {
  /** Ventes, remises déduites. */
  ventes: number;
  /** Valeur rendue aux clients (retours et échanges). */
  retours: number;
  /** Chiffre d'affaires net : ventes − retours. */
  chiffreAffaires: number;
  /** Coût d'achat des articles vendus, moins celui des articles revenus en stock. */
  cout: number;
  benefice: number;
  nombreVentes: number;
  quantite: number;
}

const vide = (): Chiffres => ({
  ventes: 0,
  retours: 0,
  chiffreAffaires: 0,
  cout: 0,
  benefice: 0,
  nombreVentes: 0,
  quantite: 0,
});

/** Clé de période à l'heure de la boutique : 2026-10-20, 2026-S43, 2026-10. */
export function clePeriode(iso: string, regroupement: Regroupement, fuseau: string): string {
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (t: string) => parties.find((p) => p.type === t)?.value ?? '';
  const [annee, mois, jour] = [v('year'), v('month'), v('day')];
  if (regroupement === 'jour') return `${annee}-${mois}-${jour}`;
  if (regroupement === 'mois') return `${annee}-${mois}`;
  // Semaine ISO 8601 (du lundi au dimanche).
  const date = new Date(Date.UTC(Number(annee), Number(mois) - 1, Number(jour)));
  const jourSemaine = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - jourSemaine);
  const debutAnnee = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const semaine = Math.ceil(((date.getTime() - debutAnnee.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-S${String(semaine).padStart(2, '0')}`;
}

/** Libellé lisible d'une clé de période. */
export function libellePeriode(cle: string): string {
  const semaine = /^(\d{4})-S(\d{2})$/.exec(cle);
  if (semaine) return `Semaine ${Number(semaine[2])} de ${semaine[1]}`;
  const [annee, mois, jour] = cle.split('-');
  return jour ? `${jour}/${mois}/${annee}` : `${mois}/${annee}`;
}

function ajouter(
  carte: Map<string, Chiffres>,
  cle: string,
  modification: (c: Chiffres) => void,
): void {
  const c = carte.get(cle) ?? vide();
  modification(c);
  carte.set(cle, c);
}

const finaliser = (c: Chiffres) => {
  c.chiffreAffaires = c.ventes - c.retours;
  c.benefice = c.chiffreAffaires - c.cout;
  return c;
};

/**
 * Chiffre d'affaires et bénéfice brut. Chaque ligne porte sa part de la remise de la
 * vente (au prorata) ; un retour diminue le chiffre d'affaires du jour du retour, et
 * le coût de ce qui revient en stock.
 */
export function rapportVentes(
  ventes: VenteRapport[],
  retours: RetourRapport[],
  regroupement: Regroupement,
  fuseau: string,
) {
  const total = vide();
  const parPeriode = new Map<string, Chiffres>();
  const parVendeur = new Map<string, Chiffres>();
  const parProduit = new Map<string, Chiffres>();
  for (const v of ventes) {
    const periode = clePeriode(v.date, regroupement, fuseau);
    const ratio = v.sousTotal > 0 ? (v.sousTotal - v.remise) / v.sousTotal : 0;
    let montantVente = 0;
    for (const l of v.lignes) {
      const montant = Math.round(l.total * ratio);
      const cout = l.prixAchat * l.quantite;
      montantVente += montant;
      for (const [carte, cle] of [
        [parPeriode, periode],
        [parVendeur, v.vendeurId],
        [parProduit, l.produitId],
      ] as const) {
        ajouter(carte, cle, (c) => {
          c.ventes += montant;
          c.cout += cout;
          c.quantite += l.quantite;
        });
      }
      total.cout += cout;
      total.quantite += l.quantite;
    }
    total.ventes += montantVente;
    total.nombreVentes++;
    ajouter(parPeriode, periode, (c) => c.nombreVentes++);
    ajouter(parVendeur, v.vendeurId, (c) => c.nombreVentes++);
  }
  for (const r of retours) {
    const periode = clePeriode(r.date, regroupement, fuseau);
    for (const l of r.lignes) {
      const recupere = l.destination === 'REBUT' ? 0 : l.coutUnitaire * l.quantite;
      for (const [carte, cle] of [
        [parPeriode, periode],
        [parVendeur, r.vendeurId],
        [parProduit, l.produitId],
      ] as const) {
        ajouter(carte, cle, (c) => {
          c.retours += l.montant;
          c.cout -= recupere;
          c.quantite -= l.quantite;
        });
      }
      total.retours += l.montant;
      total.cout -= recupere;
      total.quantite -= l.quantite;
    }
  }
  const liste = (carte: Map<string, Chiffres>) =>
    [...carte.entries()].map(([cle, c]) => ({ cle, ...finaliser(c) }));
  return {
    total: finaliser(total),
    parPeriode: liste(parPeriode).sort((a, b) => a.cle.localeCompare(b.cle)),
    parVendeur: liste(parVendeur).sort((a, b) => b.chiffreAffaires - a.chiffreAffaires),
    /** Meilleures ventes d'abord. */
    parProduit: liste(parProduit).sort(
      (a, b) => b.chiffreAffaires - a.chiffreAffaires || b.quantite - a.quantite,
    ),
  };
}
export type RapportVentes = ReturnType<typeof rapportVentes>;

export interface ProduitStock {
  produitId: string;
  nom: string;
  quantite: number;
  /** Valeur au prix d'achat (téléphones : coût réel de chaque IMEI). */
  valeurAchat: number;
  /** Valeur au prix de vente (détail, ou prix d'occasion). */
  valeurVente: number;
  derniereVente: string | null;
}

/** Valeur du stock et articles sans vente depuis `jours` jours (en stock seulement). */
export function rapportStock(produits: ProduitStock[], jours: number, maintenant: Date) {
  const limite = maintenant.getTime() - jours * 86_400_000;
  const enStock = produits.filter((p) => p.quantite > 0);
  return {
    quantite: enStock.reduce((t, p) => t + p.quantite, 0),
    valeurAchat: enStock.reduce((t, p) => t + p.valeurAchat, 0),
    valeurVente: enStock.reduce((t, p) => t + p.valeurVente, 0),
    produits: [...enStock].sort((a, b) => b.valeurAchat - a.valeurAchat),
    sansVente: enStock
      .filter((p) => !p.derniereVente || new Date(p.derniereVente).getTime() < limite)
      .sort(
        (a, b) =>
          (a.derniereVente ? new Date(a.derniereVente).getTime() : 0) -
            (b.derniereVente ? new Date(b.derniereVente).getTime() : 0) ||
          b.valeurAchat - a.valeurAchat,
      ),
  };
}
export type RapportStock = ReturnType<typeof rapportStock>;

/** Libellés du journal d'audit (les actions inconnues s'affichent telles quelles). */
export const LIBELLES_ACTIONS_AUDIT: Record<string, string> = {
  CONNEXION: 'Connexion',
  CONNEXION_ECHEC: 'Connexion refusée',
  DECONNEXION: 'Déconnexion',
  DECONNEXION_A_DISTANCE: 'Appareil déconnecté à distance',
  JETON_REUTILISE: 'Session volée détectée',
  PIN_DEFINI: 'Code PIN défini',
  AJUSTEMENT_STOCK: 'Ajustement de stock',
  SORTIE_ARTICLE: 'Téléphone sorti du stock',
  CONFLIT_TRAITE: 'Conflit traité',
  PRODUIT_CREE: 'Produit créé',
  PRIX_MODIFIE: 'Prix modifié',
  PRODUIT_ARCHIVE: 'Produit archivé',
  PRODUIT_RESTAURE: 'Produit restauré',
  PHOTO_MODIFIEE: 'Photo de produit modifiée',
  IMPORT_CATALOGUE: 'Import du catalogue',
  PLAFOND_CREDIT_MODIFIE: 'Plafond de crédit modifié',
  PIECE_IDENTITE_MODIFIEE: 'Pièce d’identité modifiée',
  PIECE_IDENTITE_CONSULTEE: 'Pièce d’identité consultée',
  RECEPTION_ACHAT: 'Réception d’achat',
  PAIEMENT_FOURNISSEUR: 'Paiement fournisseur',
  ANNULATION_ACHAT: 'Achat annulé',
  INVENTAIRE_VALIDE: 'Inventaire validé',
  REMISE_AUTORISEE: 'Remise autorisée par un gérant',
  REMISE_ACCORDEE: 'Remise accordée',
  ECART_PRIX: 'Vente à un prix différent',
  VENTE_ANNULEE: 'Vente annulée',
  RETOUR_AUTORISE: 'Retour autorisé par un gérant',
  RETOUR_ENREGISTRE: 'Retour ou échange',
  CAISSE_OUVERTE: 'Caisse ouverte',
  CAISSE_CLOTUREE: 'Caisse clôturée',
  CAISSE_VALIDEE: 'Caisse validée',
  DEPENSE_ENREGISTREE: 'Dépense',
  JUSTIFICATIF_MODIFIE: 'Justificatif de dépense',
  TROC_ENREGISTRE: 'Troc (reprise d’un téléphone)',
  REPRISE_AUTORISEE: 'Reprise autorisée par un gérant',
  REPRISE_AJUSTEE: 'Valeur de reprise ajustée',
  GRILLE_REPRISE_MODIFIEE: 'Grille de reprise modifiée',
  IMEI_SIGNALE: 'IMEI signalé volé ou bloqué',
  REMISE_EN_VENTE: 'Appareil repris remis en vente',
  PHOTO_TROC: 'Photo d’un appareil repris',
  CREDIT_ACCORDE: 'Vente à crédit',
  ENCAISSEMENT_CREDIT: 'Tranche de crédit encaissée',
  PENALITE_APPLIQUEE: 'Pénalité de retard',
  RELANCE_MANUELLE: 'Relance d’un client',
  PARAMETRES_RAPPELS: 'Réglages des rappels et pénalités',
  BOUTIQUE_CREEE: 'Boutique créée',
  BOUTIQUE_MODIFIEE: 'Boutique modifiée',
  EMPLOYE_CREE: 'Employé créé',
  EMPLOYE_MODIFIE: 'Employé modifié (rôle, boutiques, accès)',
  MOT_DE_PASSE_REINITIALISE: 'Mot de passe réinitialisé',
  TRANSFERT_ENVOYE: 'Transfert envoyé',
  TRANSFERT_RECU: 'Transfert reçu',
  TRANSFERT_ECART: 'Écart à la réception d’un transfert',
  TRANSFERT_ANNULE: 'Transfert annulé',
};

/** Familles d'actions proposées comme filtre dans l'écran du journal. */
export const FAMILLES_AUDIT: Record<string, string[]> = {
  Équipe: [
    'BOUTIQUE_CREEE',
    'BOUTIQUE_MODIFIEE',
    'EMPLOYE_CREE',
    'EMPLOYE_MODIFIE',
    'MOT_DE_PASSE_REINITIALISE',
  ],
  Connexions: [
    'CONNEXION',
    'CONNEXION_ECHEC',
    'DECONNEXION',
    'DECONNEXION_A_DISTANCE',
    'JETON_REUTILISE',
  ],
  Remises: ['REMISE_AUTORISEE', 'REMISE_ACCORDEE', 'ECART_PRIX'],
  Prix: ['PRIX_MODIFIE', 'PRODUIT_CREE', 'IMPORT_CATALOGUE'],
  'Annulations et suppressions': [
    'VENTE_ANNULEE',
    'ANNULATION_ACHAT',
    'PRODUIT_ARCHIVE',
    'SORTIE_ARTICLE',
    'RETOUR_ENREGISTRE',
  ],
  Stock: [
    'AJUSTEMENT_STOCK',
    'INVENTAIRE_VALIDE',
    'RECEPTION_ACHAT',
    'SORTIE_ARTICLE',
    'TRANSFERT_ENVOYE',
    'TRANSFERT_RECU',
    'TRANSFERT_ECART',
    'TRANSFERT_ANNULE',
  ],
  Caisse: ['CAISSE_OUVERTE', 'CAISSE_CLOTUREE', 'CAISSE_VALIDEE', 'DEPENSE_ENREGISTREE'],
  Troc: [
    'TROC_ENREGISTRE',
    'REPRISE_AUTORISEE',
    'REPRISE_AJUSTEE',
    'GRILLE_REPRISE_MODIFIEE',
    'IMEI_SIGNALE',
    'REMISE_EN_VENTE',
  ],
  Crédit: [
    'CREDIT_ACCORDE',
    'ENCAISSEMENT_CREDIT',
    'PLAFOND_CREDIT_MODIFIE',
    'PENALITE_APPLIQUEE',
    'RELANCE_MANUELLE',
    'PARAMETRES_RAPPELS',
  ],
};

/** Section d'un rapport imprimable : un tableau (valeurs déjà mises en forme). */
export interface SectionRapport {
  titre: string;
  colonnes: string[];
  lignes: string[][];
  /** Colonnes alignées à droite (montants, quantités). */
  aDroite?: number[];
}

const echapper = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rapport A4 (PDF ou impression), une section par tableau. */
export function rapportHtml(titre: string, sousTitre: string, sections: SectionRapport[]): string {
  const corps = sections
    .map((s) => {
      const cellule = (texte: string, i: number, balise: 'td' | 'th') =>
        `<${balise}${s.aDroite?.includes(i) ? ' class="n"' : ''}>${echapper(texte)}</${balise}>`;
      const entete = s.colonnes.map((c, i) => cellule(c, i, 'th')).join('');
      const lignes = s.lignes.length
        ? s.lignes
            .map((l) => `<tr>${l.map((c, i) => cellule(c, i, 'td')).join('')}</tr>`)
            .join('\n')
        : `<tr><td colspan="${s.colonnes.length}" class="vide">Aucune donnée.</td></tr>`;
      return `<h2>${echapper(s.titre)}</h2><table><thead><tr>${entete}</tr></thead><tbody>\n${lignes}\n</tbody></table>`;
    })
    .join('\n');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${echapper(titre)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #111; margin: 0; }
h1 { font-size: 17pt; color: #1d4ed8; margin: 0; }
h2 { font-size: 12pt; margin: 18px 0 6px; }
.discret { color: #555; }
table { width: 100%; border-collapse: collapse; }
th { background: #eef2ff; text-align: left; padding: 5px 6px; }
td { padding: 5px 6px; border-bottom: 1px solid #ddd; }
.n { text-align: right; white-space: nowrap; }
.vide { color: #777; font-style: italic; }
</style></head><body>
<h1>${echapper(titre)}</h1>
<div class="discret">${echapper(sousTitre)}</div>
${corps}
</body></html>`;
}
