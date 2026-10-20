import {
  type AchatSaisi,
  type Controle,
  controlerImeis,
  ecartQuantite,
  ecartsTelephones,
  erreurPaiementAchat,
  erreurReception,
  type InventaireSaisi,
  type ReceptionSaisie,
  statutApresReception,
  totalAchat,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import type { ContexteCatalogue } from '../catalogue/catalogue.ecritures.js';
import { detteFournisseur } from '../clients/clients.ecritures.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import {
  versAchat,
  versArticle,
  versFournisseur,
  versLigneAchat,
  versStock,
} from '../sync/serialisation.js';

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Controle => ({ ok: false, statut: 'CONFLIT', motif });

/** Bon de la boutique et du commerce de l'utilisateur, ou null. */
async function achatDe(tx: Tx, commerceId: string, boutiqueId: string, achatId: string) {
  return tx.achat.findFirst({
    where: { id: achatId, commerceId, boutiqueId },
    include: { lignes: true },
  });
}

/** Changements du bon, de ses lignes et de la dette du fournisseur. */
async function changementsAchat(tx: Tx, achatId: string): Promise<NouveauChangement[]> {
  const achat = await tx.achat.findUniqueOrThrow({
    where: { id: achatId },
    include: { lignes: true, fournisseur: true },
  });
  return [
    { entite: 'achat', id: achat.id, boutiqueId: achat.boutiqueId, donnees: versAchat(achat) },
    ...achat.lignes.map((l) => ({
      entite: 'ligneAchat' as const,
      id: l.id,
      boutiqueId: achat.boutiqueId,
      donnees: versLigneAchat(l),
    })),
    {
      entite: 'fournisseur',
      id: achat.fournisseurId,
      boutiqueId: null,
      donnees: versFournisseur(achat.fournisseur, await detteFournisseur(tx, achat.fournisseurId)),
    },
  ];
}

/** Stock d'un produit dans une boutique, créé à zéro au besoin. */
async function stockDe(tx: Tx, produitId: string, boutiqueId: string) {
  return tx.stock.upsert({
    where: { produitId_boutiqueId: { produitId, boutiqueId } },
    create: { produitId, boutiqueId, quantite: 0 },
    update: {},
  });
}

/** Crée ou remplace un bon d'achat tant que rien n'a été reçu. */
export async function enregistrerAchat(
  { tx, utilisateur, journal }: ContexteCatalogue,
  boutiqueId: string,
  d: AchatSaisi,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existant = await tx.achat.findUnique({ where: { id: d.id } });
  if (existant && (existant.commerceId !== commerceId || existant.boutiqueId !== boutiqueId)) {
    return rejet('Identifiant déjà utilisé.');
  }
  if (existant && existant.statut !== 'BROUILLON') {
    return conflit('Ce bon a déjà été réceptionné ou annulé : il ne peut plus être modifié.');
  }
  if (!(await tx.fournisseur.findFirst({ where: { id: d.fournisseurId, commerceId } }))) {
    return rejet('Fournisseur inconnu.');
  }
  const produits = await tx.produit.count({
    where: { id: { in: d.lignes.map((l) => l.produitId) }, commerceId },
  });
  if (produits !== d.lignes.length) return rejet('Un des produits est inconnu.');
  const numero = await tx.achat.findFirst({
    where: { commerceId, numero: d.numero, id: { not: d.id } },
  });
  if (numero) return rejet(`Le numéro ${d.numero} est déjà utilisé.`);
  const autresLignes = await tx.ligneAchat.findFirst({
    where: { id: { in: d.lignes.map((l) => l.id) }, achatId: { not: d.id } },
  });
  if (autresLignes) return rejet('Identifiant de ligne déjà utilisé.');

  const champs = {
    fournisseurId: d.fournisseurId,
    numero: d.numero,
    dateAchat: new Date(`${d.dateAchat}T00:00:00Z`),
    note: d.note || null,
    montantTotal: totalAchat(d.lignes),
  };
  const anciennes = existant ? await tx.ligneAchat.findMany({ where: { achatId: d.id } }) : [];
  await tx.achat.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, boutiqueId, creeParId: utilisateur.id, ...champs },
    update: champs,
  });
  await tx.ligneAchat.deleteMany({ where: { achatId: d.id } });
  await tx.ligneAchat.createMany({ data: d.lignes.map((l) => ({ ...l, achatId: d.id })) });
  const retirees = anciennes.filter((a) => !d.lignes.some((l) => l.id === a.id));
  await journal.ecrire(tx, commerceId, [
    ...retirees.map((l) => ({
      entite: 'ligneAchat' as const,
      id: l.id,
      boutiqueId,
      donnees: null,
    })),
    ...(await changementsAchat(tx, d.id)),
  ]);
  return OK;
}

/**
 * Réception totale ou partielle : chaque IMEI devient un téléphone en stock,
 * chaque quantité d'accessoire augmente le stock ; un mouvement par entrée.
 * Un IMEI déjà connu du commerce fait refuser toute la réception (conflit).
 */
export async function recevoirAchat(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  boutiqueId: string,
  d: ReceptionSaisie,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const achat = await achatDe(tx, commerceId, boutiqueId, d.achatId);
  if (!achat) return rejet('Bon d’achat introuvable dans cette boutique.');
  if (achat.statut === 'ANNULE') return conflit('Ce bon d’achat a été annulé.');
  const produits = await tx.produit.findMany({
    where: { id: { in: achat.lignes.map((l) => l.produitId) } },
    select: { id: true, type: true, nom: true },
  });

  // Contrôles : quantités, IMEI valides, uniques et inconnus du commerce.
  const imeisSaisis = d.lignes.flatMap((r) => r.articles?.map((a) => a.imei) ?? []);
  const connus = new Set(
    (
      await tx.article.findMany({
        where: { commerceId, imei: { in: imeisSaisis.map((i) => i.replace(/[\s-]/g, '')) } },
        select: { imei: true },
      })
    ).map((a) => a.imei),
  );
  const imeis = controlerImeis(imeisSaisis, (i) => connus.has(i));
  if (imeis.invalides.length) return rejet(`IMEI invalide(s) : ${imeis.invalides.join(', ')}.`);
  if (imeis.doublons.length)
    return rejet(`IMEI saisi(s) deux fois : ${imeis.doublons.join(', ')}.`);
  if (imeis.dejaConnus.length)
    return conflit(`IMEI déjà enregistré(s) : ${imeis.dejaConnus.join(', ')}.`);
  const idsArticles = d.lignes.flatMap((r) => r.articles?.map((a) => a.id) ?? []);
  if (idsArticles.length && (await tx.article.count({ where: { id: { in: idsArticles } } }))) {
    return rejet('Identifiant d’article déjà utilisé.');
  }
  for (const r of d.lignes) {
    const ligne = achat.lignes.find((l) => l.id === r.ligneId);
    const produit = produits.find((p) => p.id === ligne?.produitId);
    if (!ligne || !produit) return rejet('Ligne de bon inconnue.');
    const erreur = erreurReception({ ...ligne, type: produit.type, nom: produit.nom }, r);
    if (erreur) return conflit(erreur);
  }

  // Écritures.
  const changements: NouveauChangement[] = [];
  for (const r of d.lignes) {
    const ligne = achat.lignes.find((l) => l.id === r.ligneId)!;
    const quantite = r.articles?.length ?? r.quantite ?? 0;
    for (const a of r.articles ?? []) {
      const article = await tx.article.create({
        data: {
          id: a.id,
          commerceId,
          produitId: ligne.produitId,
          boutiqueId,
          imei: a.imei.replace(/[\s-]/g, ''),
          prixAchat: ligne.prixAchat,
          ligneAchatId: ligne.id,
          creeParId: utilisateur.id,
        },
      });
      changements.push({
        entite: 'article',
        id: article.id,
        boutiqueId,
        donnees: versArticle(article),
      });
    }
    await tx.mouvementStock.createMany({
      data: r.articles?.length
        ? r.articles.map((a) => ({
            commerceId,
            boutiqueId,
            produitId: ligne.produitId,
            articleId: a.id,
            type: 'ACHAT' as const,
            quantite: 1,
            referenceType: 'Achat',
            referenceId: achat.id,
            utilisateurId: utilisateur.id,
          }))
        : [
            {
              commerceId,
              boutiqueId,
              produitId: ligne.produitId,
              type: 'ACHAT' as const,
              quantite,
              referenceType: 'Achat',
              referenceId: achat.id,
              utilisateurId: utilisateur.id,
            },
          ],
    });
    await stockDe(tx, ligne.produitId, boutiqueId);
    const stock = await tx.stock.update({
      where: { produitId_boutiqueId: { produitId: ligne.produitId, boutiqueId } },
      data: { quantite: { increment: quantite } },
    });
    changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
    await tx.ligneAchat.update({
      where: { id: ligne.id },
      data: { quantiteRecue: { increment: quantite } },
    });
  }
  const lignes = await tx.ligneAchat.findMany({ where: { achatId: achat.id } });
  await tx.achat.update({
    where: { id: achat.id },
    data: { statut: statutApresReception(lignes) },
  });
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsAchat(tx, achat.id))]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.RECEPTION_ACHAT,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Achat',
      entiteId: achat.id,
      details: { numero: achat.numero, imeis: imeis.valides.length, lignes: d.lignes.length },
    },
    tx,
  );
  return OK;
}

export async function payerAchat(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  boutiqueId: string,
  d: { achatId: string; montant: number },
): Promise<Controle> {
  const achat = await achatDe(tx, utilisateur.commerceId, boutiqueId, d.achatId);
  if (!achat) return rejet('Bon d’achat introuvable dans cette boutique.');
  if (achat.statut === 'ANNULE') return conflit('Ce bon d’achat a été annulé.');
  const erreur = erreurPaiementAchat(
    Number(achat.montantTotal),
    Number(achat.montantPaye),
    d.montant,
  );
  if (erreur) return conflit(erreur);
  await tx.achat.update({
    where: { id: achat.id },
    data: { montantPaye: { increment: d.montant } },
  });
  await journal.ecrire(tx, utilisateur.commerceId, await changementsAchat(tx, achat.id));
  await audit.journaliser(
    {
      commerceId: utilisateur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.PAIEMENT_FOURNISSEUR,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Achat',
      entiteId: achat.id,
      details: { numero: achat.numero, montant: d.montant },
    },
    tx,
  );
  return OK;
}

export async function annulerAchat(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  boutiqueId: string,
  d: { achatId: string },
): Promise<Controle> {
  const achat = await achatDe(tx, utilisateur.commerceId, boutiqueId, d.achatId);
  if (!achat) return rejet('Bon d’achat introuvable dans cette boutique.');
  if (achat.statut === 'ANNULE') return OK;
  if (achat.lignes.some((l) => l.quantiteRecue > 0)) {
    return conflit('Des produits de ce bon ont déjà été reçus : il ne peut plus être annulé.');
  }
  await tx.achat.update({ where: { id: achat.id }, data: { statut: 'ANNULE' } });
  await journal.ecrire(tx, utilisateur.commerceId, await changementsAchat(tx, achat.id));
  await audit.journaliser(
    {
      commerceId: utilisateur.commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.ANNULATION_ACHAT,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Achat',
      entiteId: achat.id,
      details: { numero: achat.numero },
    },
    tx,
  );
  return OK;
}

export async function definirSeuil(
  { tx, utilisateur, journal }: ContexteCatalogue,
  boutiqueId: string,
  d: { produitId: string; seuilMinimum: number },
): Promise<Controle> {
  if (
    !(await tx.produit.findFirst({
      where: { id: d.produitId, commerceId: utilisateur.commerceId },
    }))
  ) {
    return rejet('Produit inconnu.');
  }
  await stockDe(tx, d.produitId, boutiqueId);
  const stock = await tx.stock.update({
    where: { produitId_boutiqueId: { produitId: d.produitId, boutiqueId } },
    data: { seuilMinimum: d.seuilMinimum },
  });
  await journal.ecrire(tx, utilisateur.commerceId, [
    { entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) },
  ]);
  return OK;
}

/**
 * Inventaire validé : le stock suit le comptage. Accessoires : quantité comptée ;
 * téléphones : ceux en stock non scannés sortent du stock (manquants). Les écarts
 * sont enregistrés (lignes d'inventaire, mouvements, journal d'audit).
 */
export async function validerInventaire(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  boutiqueId: string,
  d: InventaireSaisi,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  if (await tx.inventaire.findUnique({ where: { id: d.id } }))
    return rejet('Identifiant déjà utilisé.');
  const produits = await tx.produit.findMany({
    where: { id: { in: d.lignes.map((l) => l.produitId) }, commerceId },
    select: { id: true, type: true, nom: true },
  });
  if (produits.length !== new Set(d.lignes.map((l) => l.produitId)).size)
    return rejet('Un des produits est inconnu.');
  for (const l of d.lignes) {
    const p = produits.find((x) => x.id === l.produitId)!;
    if (p.type === 'TELEPHONE' && l.quantiteComptee !== undefined) {
      return rejet(`« ${p.nom} » : un téléphone se compte en scannant ses IMEI.`);
    }
    if (p.type === 'ACCESSOIRE' && l.quantiteComptee === undefined) {
      return rejet(`« ${p.nom} » : quantité comptée manquante.`);
    }
  }

  await tx.inventaire.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      statut: 'VALIDE',
      motif: d.motif,
      valideLe: new Date(),
      valideParId: utilisateur.id,
      creeParId: utilisateur.id,
    },
  });
  const motif = `Inventaire : ${d.motif}`;
  const changements: NouveauChangement[] = [];
  const bilan: {
    produit: string;
    theorique: number;
    comptee: number;
    ecart: number;
    inconnus?: string[];
  }[] = [];

  for (const l of d.lignes) {
    const produit = produits.find((p) => p.id === l.produitId)!;
    const stockAvant = await stockDe(tx, produit.id, boutiqueId);
    if (produit.type === 'ACCESSOIRE') {
      const comptee = l.quantiteComptee ?? 0;
      const ecart = ecartQuantite(stockAvant.quantite, comptee);
      await tx.ligneInventaire.create({
        data: {
          inventaireId: d.id,
          produitId: produit.id,
          quantiteTheorique: stockAvant.quantite,
          quantiteComptee: comptee,
        },
      });
      if (ecart !== 0) {
        const stock = await tx.stock.update({
          where: { id: stockAvant.id },
          data: { quantite: comptee },
        });
        await tx.mouvementStock.create({
          data: {
            commerceId,
            boutiqueId,
            produitId: produit.id,
            type: 'AJUSTEMENT',
            quantite: ecart,
            motif,
            referenceType: 'Inventaire',
            referenceId: d.id,
            utilisateurId: utilisateur.id,
          },
        });
        changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
      }
      bilan.push({ produit: produit.nom, theorique: stockAvant.quantite, comptee, ecart });
      continue;
    }

    const enStock = await tx.article.findMany({
      where: {
        commerceId,
        boutiqueId,
        produitId: produit.id,
        statut: { in: ['EN_STOCK', 'A_REPARER'] },
      },
    });
    const ecarts = ecartsTelephones(enStock, l.imeis ?? []);
    for (const manquant of ecarts.manquants) {
      const sorti = await tx.article.update({
        where: { id: manquant.id },
        data: { statut: 'REBUT' },
      });
      await tx.mouvementStock.create({
        data: {
          commerceId,
          boutiqueId,
          produitId: produit.id,
          articleId: manquant.id,
          type: 'REBUT',
          quantite: -1,
          motif: `${motif} (manquant)`,
          referenceType: 'Inventaire',
          referenceId: d.id,
          utilisateurId: utilisateur.id,
        },
      });
      await tx.ligneInventaire.create({
        data: {
          inventaireId: d.id,
          produitId: produit.id,
          articleId: manquant.id,
          quantiteTheorique: 1,
          quantiteComptee: 0,
          motifEcart: 'Manquant',
        },
      });
      changements.push({
        entite: 'article',
        id: sorti.id,
        boutiqueId,
        donnees: versArticle(sorti),
      });
    }
    await tx.ligneInventaire.create({
      data: {
        inventaireId: d.id,
        produitId: produit.id,
        quantiteTheorique: enStock.length,
        quantiteComptee: ecarts.presents.length,
        motifEcart: ecarts.inconnus.length
          ? `IMEI scannés hors stock : ${ecarts.inconnus.join(', ')}`
          : null,
      },
    });
    const enStockApres = await tx.article.count({
      where: { boutiqueId, produitId: produit.id, statut: 'EN_STOCK' },
    });
    const stock = await tx.stock.update({
      where: { id: stockAvant.id },
      data: { quantite: enStockApres },
    });
    changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
    bilan.push({
      produit: produit.nom,
      theorique: enStock.length,
      comptee: ecarts.presents.length,
      ecart: -ecarts.manquants.length,
      ...(ecarts.inconnus.length ? { inconnus: ecarts.inconnus } : {}),
    });
  }

  await journal.ecrire(tx, commerceId, changements);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.INVENTAIRE_VALIDE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Inventaire',
      entiteId: d.id,
      details: { motif: d.motif, ecarts: bilan.filter((b) => b.ecart !== 0 || b.inconnus) },
    },
    tx,
  );
  return OK;
}
