import { normaliserRecherche } from '@gestvente/commun';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import {
  versCategorie,
  versCompatibilite,
  versMarque,
  versModele,
  versProduit,
} from '../sync/serialisation.js';
import {
  ACCESSOIRES_REFERENCE,
  CATEGORIES_REFERENCE,
  GARANTIE_TELEPHONE_MOIS,
  nomTelephone,
  prixDerives,
  TELEPHONES_REFERENCE,
} from './reference.js';

export interface BilanInstallation {
  categories: number;
  marques: number;
  modeles: number;
  produits: number;
  compatibilites: number;
  /** Changements à inscrire au journal (appareils déjà en service). */
  changements: NouveauChangement[];
}

const cle = (texte: string) => normaliserRecherche(texte);

/**
 * Ajoute au commerce ce qui lui manque du catalogue de base (comparé par nom, sans
 * tenir compte des accents ni des majuscules). Rien de ce que le commerçant a créé
 * ou modifié n'est remplacé : relancer l'installation est sans risque.
 */
export async function installerCatalogueReference(
  tx: Tx,
  commerceId: string,
  creeParId: string | null = null,
): Promise<BilanInstallation> {
  const changements: NouveauChangement[] = [];
  const global = (entite: NouveauChangement['entite'], id: string, donnees: unknown) =>
    changements.push({ entite, id, boutiqueId: null, donnees } as NouveauChangement);

  // Catégories.
  const categoriesExistantes = await tx.categorie.findMany({ where: { commerceId } });
  const categories = new Map(categoriesExistantes.map((c) => [cle(c.nom), c]));
  const nouvellesCategories = await tx.categorie.createManyAndReturn({
    data: CATEGORIES_REFERENCE.filter((c) => !categories.has(cle(c.nom))).map((c) => ({
      commerceId,
      nom: c.nom,
      type: c.type,
      creeParId,
    })),
  });
  for (const c of nouvellesCategories) {
    categories.set(cle(c.nom), c);
    global('categorie', c.id, versCategorie(c));
  }

  // Marques.
  const nomsMarques = new Set([
    ...TELEPHONES_REFERENCE.map((t) => t.marque),
    ...ACCESSOIRES_REFERENCE.flatMap((a) => (a.marque ? [a.marque] : [])),
  ]);
  const marquesExistantes = await tx.marque.findMany({ where: { commerceId } });
  const marques = new Map(marquesExistantes.map((m) => [cle(m.nom), m]));
  const nouvellesMarques = await tx.marque.createManyAndReturn({
    data: [...nomsMarques]
      .filter((nom) => !marques.has(cle(nom)))
      .map((nom) => ({ commerceId, nom, creeParId })),
  });
  for (const m of nouvellesMarques) {
    marques.set(cle(m.nom), m);
    global('marque', m.id, versMarque(m));
  }

  // Modèles (clé « marque modèle »).
  const modelesExistants = await tx.modele.findMany({ where: { commerceId } });
  const nomMarque = new Map([...marques.values()].map((m) => [m.id, m.nom]));
  const modeles = new Map(
    modelesExistants.map((m) => [cle(`${nomMarque.get(m.marqueId) ?? ''} ${m.nom}`), m]),
  );
  const aCreer = new Map<string, { marqueId: string; nom: string }>();
  for (const t of TELEPHONES_REFERENCE) {
    const k = cle(`${t.marque} ${t.modele}`);
    if (!modeles.has(k)) aCreer.set(k, { marqueId: marques.get(cle(t.marque))!.id, nom: t.modele });
  }
  const nouveauxModeles = await tx.modele.createManyAndReturn({
    data: [...aCreer.values()].map((m) => ({ ...m, commerceId, creeParId })),
  });
  for (const m of nouveauxModeles) {
    modeles.set(cle(`${nomMarque.get(m.marqueId)} ${m.nom}`), m);
    global('modele', m.id, versModele(m));
  }

  // Produits (téléphones puis accessoires), sans photo, absents du commerce seulement.
  const nomsExistants = new Set(
    (await tx.produit.findMany({ where: { commerceId }, select: { nom: true } })).map((p) =>
      cle(p.nom),
    ),
  );
  const telephones = TELEPHONES_REFERENCE.flatMap((t) =>
    t.variantes.map(([capacite, prixDetail]) => ({
      commerceId,
      type: 'TELEPHONE' as const,
      categorieId: categories.get(cle(t.categorie ?? 'Smartphones'))!.id,
      marqueId: marques.get(cle(t.marque))!.id,
      modeleId: modeles.get(cle(`${t.marque} ${t.modele}`))!.id,
      nom: nomTelephone(t, capacite),
      capacite,
      garantieMois: GARANTIE_TELEPHONE_MOIS,
      prixDetail,
      ...prixDerives(prixDetail),
      creeParId,
    })),
  );
  const accessoires = ACCESSOIRES_REFERENCE.map((a) => ({
    commerceId,
    type: 'ACCESSOIRE' as const,
    categorieId: categories.get(cle(a.categorie))!.id,
    marqueId: a.marque ? marques.get(cle(a.marque))!.id : null,
    nom: a.nom,
    garantieMois: a.garantieMois ?? 0,
    prixDetail: a.prixDetail,
    ...prixDerives(a.prixDetail),
    // Gros à partir de 10 pièces : les revendeurs achètent les accessoires par lots.
    seuilGros: 10,
    creeParId,
  }));
  const nouveauxProduits = await tx.produit.createManyAndReturn({
    data: [...telephones, ...accessoires].filter((p) => !nomsExistants.has(cle(p.nom))),
  });
  for (const p of nouveauxProduits) global('produit', p.id, versProduit(p));

  // Compatibilités des nouveaux accessoires (coques, protège-écrans).
  const compatibilites = ACCESSOIRES_REFERENCE.flatMap((a) => {
    const produit = nouveauxProduits.find((p) => p.nom === a.nom);
    return produit
      ? (a.compatibles ?? []).flatMap((m) => {
          const modele = modeles.get(cle(m));
          return modele ? [{ accessoireId: produit.id, modeleId: modele.id }] : [];
        })
      : [];
  });
  const nouvellesCompatibilites = await tx.compatibilite.createManyAndReturn({
    data: compatibilites,
    skipDuplicates: true,
  });
  for (const c of nouvellesCompatibilites) {
    global('compatibilite', `${c.accessoireId}:${c.modeleId}`, versCompatibilite(c));
  }

  return {
    categories: nouvellesCategories.length,
    marques: nouvellesMarques.length,
    modeles: nouveauxModeles.length,
    produits: nouveauxProduits.length,
    compatibilites: nouvellesCompatibilites.length,
    changements,
  };
}
