import {
  type ProduitStock,
  type Regroupement,
  rapportStock,
  rapportVentes,
  type RetourRapport,
  type VenteRapport,
} from '@gestvente/commun';
import type { BaseSql } from './base/sql';

export type CodePeriode = 'jour' | 'semaine' | 'mois' | 'mois-dernier' | '30j';

export const PERIODES: { id: CodePeriode; nom: string }[] = [
  { id: 'jour', nom: 'Aujourd’hui' },
  { id: 'semaine', nom: '7 jours' },
  { id: 'mois', nom: 'Ce mois' },
  { id: 'mois-dernier', nom: 'Mois dernier' },
  { id: '30j', nom: '30 jours' },
];

/** Bornes de la période à l'heure de l'appareil (début inclus, fin exclue). */
export function bornes(code: CodePeriode, maintenant = new Date()): { du: Date; au: Date } {
  const minuit = new Date(maintenant);
  minuit.setHours(0, 0, 0, 0);
  const demain = new Date(minuit);
  demain.setDate(demain.getDate() + 1);
  const jours = (n: number) => {
    const d = new Date(minuit);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (code) {
    case 'jour':
      return { du: minuit, au: demain };
    case 'semaine':
      return { du: jours(6), au: demain };
    case '30j':
      return { du: jours(29), au: demain };
    case 'mois':
      return { du: new Date(minuit.getFullYear(), minuit.getMonth(), 1), au: demain };
    case 'mois-dernier':
      return {
        du: new Date(minuit.getFullYear(), minuit.getMonth() - 1, 1),
        au: new Date(minuit.getFullYear(), minuit.getMonth(), 1),
      };
  }
}

/**
 * Rapport des ventes calculé sur la base de l'appareil (hors ligne) : les ventes des
 * 60 derniers jours y sont, avec leur coût pour la gestion.
 */
export async function rapportVentesLocal(
  base: BaseSql,
  boutiqueId: string,
  periode: { du: Date; au: Date },
  regroupement: Regroupement,
  fuseau: string,
) {
  const parametres = [boutiqueId, periode.du.toISOString(), periode.au.toISOString()];
  const ventes = await base.tous<{
    id: string;
    dateVente: string;
    vendeurId: string;
    sousTotal: number;
    remise: number;
  }>(
    `SELECT id, dateVente, vendeurId, sousTotal, remise FROM vente
      WHERE boutiqueId = ? AND statut = 'VALIDEE' AND dateVente >= ? AND dateVente < ?`,
    parametres,
  );
  const lignes = await base.tous<{
    venteId: string;
    produitId: string;
    quantite: number;
    total: number;
    prixAchat: number | null;
  }>(
    `SELECT l.venteId, l.produitId, l.quantite, l.total, l.prixAchat FROM ligneVente l
       JOIN vente v ON v.id = l.venteId
      WHERE v.boutiqueId = ? AND v.statut = 'VALIDEE' AND v.dateVente >= ? AND v.dateVente < ?`,
    parametres,
  );
  const retours = await base.tous<{
    retourId: string;
    dateRetour: string;
    vendeurId: string;
    produitId: string;
    quantite: number;
    montant: number;
    prixAchat: number | null;
    destination: RetourRapport['lignes'][number]['destination'];
  }>(
    `SELECT r.id AS retourId, r.dateRetour, v.vendeurId, lv.produitId, lr.quantite, lr.montant,
            lv.prixAchat, lr.destination
       FROM ligneRetour lr
       JOIN retour r ON r.id = lr.retourId
       JOIN vente v ON v.id = r.venteId
       JOIN ligneVente lv ON lv.id = lr.ligneVenteId
      WHERE r.boutiqueId = ? AND r.dateRetour >= ? AND r.dateRetour < ?`,
    parametres,
  );
  const venteRapport: VenteRapport[] = ventes.map((v) => ({
    date: v.dateVente,
    vendeurId: v.vendeurId,
    sousTotal: v.sousTotal,
    remise: v.remise,
    lignes: lignes
      .filter((l) => l.venteId === v.id)
      .map((l) => ({ ...l, prixAchat: l.prixAchat ?? 0 })),
  }));
  const parRetour = new Map<string, RetourRapport>();
  for (const l of retours) {
    const r = parRetour.get(l.retourId) ?? {
      date: l.dateRetour,
      vendeurId: l.vendeurId,
      lignes: [],
    };
    r.lignes.push({
      produitId: l.produitId,
      quantite: l.quantite,
      montant: l.montant,
      coutUnitaire: l.prixAchat ?? 0,
      destination: l.destination,
    });
    parRetour.set(l.retourId, r);
  }
  const r = rapportVentes(venteRapport, [...parRetour.values()], regroupement, fuseau);
  const noms = new Map(
    (
      await base.tous<{ id: string; nom: string }>(
        `SELECT id, nom FROM produit WHERE id IN (${r.parProduit.map(() => '?').join(', ') || "''"})`,
        r.parProduit.map((p) => p.cle),
      )
    ).map((p) => [p.id, p.nom]),
  );
  return {
    ...r,
    parProduit: r.parProduit.map((p) => ({ ...p, libelle: noms.get(p.cle) ?? '—' })),
  };
}

/** Valeur du stock d'après la base de l'appareil (hors ligne). */
export async function rapportStockLocal(base: BaseSql, boutiqueId: string, jours: number) {
  const produits = await base.tous<{
    id: string;
    nom: string;
    type: 'TELEPHONE' | 'ACCESSOIRE';
    quantite: number;
    prixAchat: number | null;
    prixDetail: number;
    derniereVente: string | null;
  }>(
    `SELECT p.id, p.nom, p.type, COALESCE(s.quantite, 0) AS quantite,
            COALESCE(pb.prixAchat, p.prixAchat) AS prixAchat,
            COALESCE(pb.prixDetail, p.prixDetail) AS prixDetail,
            (SELECT MAX(v.dateVente) FROM ligneVente l JOIN vente v ON v.id = l.venteId
              WHERE l.produitId = p.id AND v.boutiqueId = ? AND v.statut = 'VALIDEE') AS derniereVente
       FROM produit p
       LEFT JOIN stock s ON s.produitId = p.id AND s.boutiqueId = ?
       LEFT JOIN prixBoutique pb ON pb.produitId = p.id AND pb.boutiqueId = ?`,
    [boutiqueId, boutiqueId, boutiqueId],
  );
  const articles = await base.tous<{
    produitId: string;
    prixAchat: number | null;
    prixRevente: number | null;
  }>(
    "SELECT produitId, prixAchat, prixRevente FROM article WHERE boutiqueId = ? AND statut IN ('EN_STOCK', 'A_REPARER')",
    [boutiqueId],
  );
  const lignes: ProduitStock[] = produits.map((p) => {
    if (p.type === 'TELEPHONE') {
      const siens = articles.filter((a) => a.produitId === p.id);
      return {
        produitId: p.id,
        nom: p.nom,
        quantite: siens.length,
        valeurAchat: siens.reduce((t, a) => t + (a.prixAchat ?? 0), 0),
        valeurVente: siens.reduce((t, a) => t + (a.prixRevente ?? p.prixDetail), 0),
        derniereVente: p.derniereVente,
      };
    }
    const quantite = Math.max(0, p.quantite);
    return {
      produitId: p.id,
      nom: p.nom,
      quantite,
      valeurAchat: quantite * (p.prixAchat ?? 0),
      valeurVente: quantite * p.prixDetail,
      derniereVente: p.derniereVente,
    };
  });
  return { jours, ...rapportStock(lignes, jours, new Date()) };
}
