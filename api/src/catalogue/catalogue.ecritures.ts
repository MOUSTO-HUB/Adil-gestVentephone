import type { Controle, ProduitSaisi } from '@gestvente/commun';
import { ACTIONS_AUDIT, type AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import type { JournalService, NouveauChangement, Tx } from '../sync/journal.service.js';
import {
  idCompatibilite,
  versCategorie,
  versMarque,
  versModele,
  versPrixBoutique,
  versProduit,
} from '../sync/serialisation.js';

/**
 * Écritures du catalogue, communes aux opérations des appareils et à l'import Excel.
 * Chacune contrôle d'abord (rejet : rien n'est écrit), puis écrit, journalise pour
 * les appareils et inscrit les changements de prix au journal d'audit.
 */
export interface ContexteCatalogue {
  tx: Tx;
  utilisateur: UtilisateurConnecte;
  journal: JournalService;
  audit: AuditService;
}

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });
const ID_PRIS = rejet('Identifiant déjà utilisé.');
const insensible = (valeur: string) => ({ equals: valeur, mode: 'insensitive' as const });

export async function enregistrerMarque(
  { tx, utilisateur, journal }: ContexteCatalogue,
  d: { id: string; nom: string },
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existante = await tx.marque.findUnique({ where: { id: d.id } });
  if (existante && existante.commerceId !== commerceId) return ID_PRIS;
  const doublon = await tx.marque.findFirst({
    where: { commerceId, nom: insensible(d.nom), id: { not: d.id } },
  });
  if (doublon) return rejet(`La marque « ${doublon.nom} » existe déjà.`);
  const marque = await tx.marque.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, nom: d.nom, creeParId: utilisateur.id },
    update: { nom: d.nom },
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'marque', id: marque.id, boutiqueId: null, donnees: versMarque(marque) },
  ]);
  return OK;
}

export async function enregistrerModele(
  { tx, utilisateur, journal }: ContexteCatalogue,
  d: { id: string; marqueId: string; nom: string },
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existant = await tx.modele.findUnique({ where: { id: d.id } });
  if (existant && existant.commerceId !== commerceId) return ID_PRIS;
  const marque = await tx.marque.findFirst({ where: { id: d.marqueId, commerceId } });
  if (!marque) return rejet('Marque inconnue.');
  const doublon = await tx.modele.findFirst({
    where: { marqueId: d.marqueId, nom: insensible(d.nom), id: { not: d.id } },
  });
  if (doublon) return rejet(`Le modèle « ${marque.nom} ${doublon.nom} » existe déjà.`);
  const modele = await tx.modele.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, marqueId: d.marqueId, nom: d.nom, creeParId: utilisateur.id },
    update: { marqueId: d.marqueId, nom: d.nom },
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'modele', id: modele.id, boutiqueId: null, donnees: versModele(modele) },
  ]);
  return OK;
}

export async function enregistrerCategorie(
  { tx, utilisateur, journal }: ContexteCatalogue,
  d: { id: string; nom: string; type: 'TELEPHONE' | 'ACCESSOIRE' },
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existante = await tx.categorie.findUnique({ where: { id: d.id } });
  if (existante && existante.commerceId !== commerceId) return ID_PRIS;
  if (
    existante &&
    existante.type !== d.type &&
    (await tx.produit.count({ where: { categorieId: d.id } }))
  ) {
    return rejet('Cette catégorie contient des produits : son type ne peut plus changer.');
  }
  const doublon = await tx.categorie.findFirst({
    where: { commerceId, nom: insensible(d.nom), id: { not: d.id } },
  });
  if (doublon) return rejet(`La catégorie « ${doublon.nom} » existe déjà.`);
  const categorie = await tx.categorie.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, nom: d.nom, type: d.type, creeParId: utilisateur.id },
    update: { nom: d.nom, type: d.type },
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'categorie', id: categorie.id, boutiqueId: null, donnees: versCategorie(categorie) },
  ]);
  return OK;
}

const prix = (p: {
  prixAchat: bigint | number;
  prixDetail: bigint | number;
  prixGros: bigint | number;
}) => ({
  prixAchat: Number(p.prixAchat),
  prixDetail: Number(p.prixDetail),
  prixGros: Number(p.prixGros),
});

export type ResultatProduit = Controle & { cree?: boolean };

/** Produit, prix communs et compatibilités (accessoires). */
export async function enregistrerProduit(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  d: ProduitSaisi,
): Promise<ResultatProduit> {
  const { commerceId } = utilisateur;
  const existant = await tx.produit.findUnique({ where: { id: d.id } });
  if (existant && existant.commerceId !== commerceId) return ID_PRIS;
  if (existant && existant.type !== d.type) {
    return rejet('Le type d’un produit (téléphone ou accessoire) ne peut pas changer.');
  }

  const categorie = await tx.categorie.findFirst({ where: { id: d.categorieId, commerceId } });
  if (!categorie) return rejet('Catégorie inconnue.');
  if (categorie.type !== d.type) {
    return rejet(
      `La catégorie « ${categorie.nom} » est réservée aux ${categorie.type === 'TELEPHONE' ? 'téléphones' : 'accessoires'}.`,
    );
  }
  if (d.marqueId && !(await tx.marque.findFirst({ where: { id: d.marqueId, commerceId } }))) {
    return rejet('Marque inconnue.');
  }
  if (d.modeleId) {
    const modele = await tx.modele.findFirst({ where: { id: d.modeleId, commerceId } });
    if (!modele) return rejet('Modèle inconnu.');
    if (d.marqueId && modele.marqueId !== d.marqueId) {
      return rejet('Ce modèle appartient à une autre marque.');
    }
  }
  const compatibles = [...new Set(d.compatibles)];
  if (
    compatibles.length &&
    (await tx.modele.count({ where: { id: { in: compatibles }, commerceId } })) !==
      compatibles.length
  ) {
    return rejet('Un des modèles compatibles est inconnu.');
  }
  if (d.codeBarres) {
    const doublon = await tx.produit.findFirst({
      where: { commerceId, codeBarres: d.codeBarres, id: { not: d.id } },
    });
    if (doublon) return rejet(`Code-barres déjà utilisé par « ${doublon.nom} ».`);
  }

  const champs = {
    type: d.type,
    categorieId: d.categorieId,
    marqueId: d.marqueId,
    modeleId: d.modeleId,
    nom: d.nom,
    capacite: d.capacite || null,
    couleur: d.couleur || null,
    etat: d.etat,
    codeBarres: d.codeBarres || null,
    garantieMois: d.garantieMois,
    prixAchat: d.prixAchat,
    prixDetail: d.prixDetail,
    prixGros: d.prixGros,
    seuilGros: d.seuilGros,
    archive: d.archive,
  };
  const produit = await tx.produit.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, creeParId: utilisateur.id, ...champs },
    update: champs,
  });

  // Compatibilités : on ajoute les nouvelles, on retire celles qui ne sont plus listées.
  const actuelles = await tx.compatibilite.findMany({ where: { accessoireId: d.id } });
  const retirees = actuelles.filter((c) => !compatibles.includes(c.modeleId));
  const ajoutees = compatibles.filter((m) => !actuelles.some((c) => c.modeleId === m));
  if (retirees.length) {
    await tx.compatibilite.deleteMany({
      where: { accessoireId: d.id, modeleId: { in: retirees.map((c) => c.modeleId) } },
    });
  }
  if (ajoutees.length) {
    await tx.compatibilite.createMany({
      data: ajoutees.map((modeleId) => ({ accessoireId: d.id, modeleId })),
    });
  }

  const changements: NouveauChangement[] = [
    { entite: 'produit', id: produit.id, boutiqueId: null, donnees: versProduit(produit) },
    ...retirees.map((c) => ({
      entite: 'compatibilite' as const,
      id: idCompatibilite(c.accessoireId, c.modeleId),
      boutiqueId: null,
      donnees: null,
    })),
    ...ajoutees.map((modeleId) => ({
      entite: 'compatibilite' as const,
      id: idCompatibilite(d.id, modeleId),
      boutiqueId: null,
      donnees: { id: idCompatibilite(d.id, modeleId), accessoireId: d.id, modeleId },
    })),
  ];
  await journal.ecrire(tx, commerceId, changements);

  const nouveaux = prix(produit);
  if (!existant) {
    await audit.journaliser(
      {
        commerceId,
        action: ACTIONS_AUDIT.PRODUIT_CREE,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        entite: 'Produit',
        entiteId: produit.id,
        details: { nom: produit.nom, ...nouveaux },
      },
      tx,
    );
  } else {
    const anciens = prix(existant);
    if (JSON.stringify(anciens) !== JSON.stringify(nouveaux)) {
      await audit.journaliser(
        {
          commerceId,
          action: ACTIONS_AUDIT.PRIX_MODIFIE,
          utilisateurId: utilisateur.id,
          appareilId: utilisateur.appareilId,
          entite: 'Produit',
          entiteId: produit.id,
          details: { nom: produit.nom, avant: anciens, apres: nouveaux },
        },
        tx,
      );
    }
    if (existant.archive !== produit.archive) {
      await audit.journaliser(
        {
          commerceId,
          action: produit.archive ? ACTIONS_AUDIT.PRODUIT_ARCHIVE : ACTIONS_AUDIT.PRODUIT_RESTAURE,
          utilisateurId: utilisateur.id,
          appareilId: utilisateur.appareilId,
          entite: 'Produit',
          entiteId: produit.id,
          details: { nom: produit.nom },
        },
        tx,
      );
    }
  }
  return { ok: true, cree: !existant };
}

/** Prix propres à une boutique ; tous nuls : retour aux prix communs. */
export async function enregistrerPrixBoutique(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  boutiqueId: string,
  d: {
    produitId: string;
    prixAchat: number | null;
    prixDetail: number | null;
    prixGros: number | null;
  },
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const produit = await tx.produit.findFirst({ where: { id: d.produitId, commerceId } });
  if (!produit) return rejet('Produit inconnu.');
  const existant = await tx.prixBoutique.findUnique({
    where: { produitId_boutiqueId: { produitId: d.produitId, boutiqueId } },
  });
  const vide = d.prixAchat === null && d.prixDetail === null && d.prixGros === null;
  const detail = d.prixDetail ?? Number(produit.prixDetail);
  const gros = d.prixGros ?? Number(produit.prixGros);
  if (!vide && gros > detail)
    return rejet('Le prix de gros ne peut pas dépasser le prix de détail.');

  if (vide) {
    if (!existant) return OK;
    await tx.prixBoutique.delete({ where: { id: existant.id } });
    await journal.ecrire(tx, commerceId, [
      { entite: 'prixBoutique', id: existant.id, boutiqueId, donnees: null },
    ]);
  } else {
    const ligne = await tx.prixBoutique.upsert({
      where: { produitId_boutiqueId: { produitId: d.produitId, boutiqueId } },
      create: { ...d, boutiqueId, creeParId: utilisateur.id },
      update: { prixAchat: d.prixAchat, prixDetail: d.prixDetail, prixGros: d.prixGros },
    });
    await journal.ecrire(tx, commerceId, [
      { entite: 'prixBoutique', id: ligne.id, boutiqueId, donnees: versPrixBoutique(ligne) },
    ]);
  }
  const avant = existant ? versPrixBoutique(existant) : null;
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.PRIX_MODIFIE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'PrixBoutique',
      entiteId: d.produitId,
      details: {
        nom: produit.nom,
        avant: avant && {
          prixAchat: avant.prixAchat,
          prixDetail: avant.prixDetail,
          prixGros: avant.prixGros,
        },
        apres: vide
          ? null
          : { prixAchat: d.prixAchat, prixDetail: d.prixDetail, prixGros: d.prixGros },
      },
    },
    tx,
  );
  return OK;
}
