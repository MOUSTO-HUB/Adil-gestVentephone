import {
  type Controle,
  controlerPaiements,
  controlerSortieArticle,
  erreurRemise,
  finGarantie,
  plafondRemise,
  pourcentageRemise,
  totauxVente,
  type VenteSaisie,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import {
  versArticle,
  versLigneVente,
  versPaiementVente,
  versStock,
  versVente,
} from '../sync/serialisation.js';

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Controle => ({ ok: false, statut: 'CONFLIT', motif });

/** Changements d'une vente pour les appareils : la vente, ses lignes, ses paiements. */
export async function changementsVente(tx: Tx, venteId: string): Promise<NouveauChangement[]> {
  const vente = await tx.vente.findUniqueOrThrow({
    where: { id: venteId },
    include: { lignes: true, paiements: true },
  });
  const boutiqueId = vente.boutiqueId;
  return [
    { entite: 'vente', id: vente.id, boutiqueId, donnees: versVente(vente) },
    ...vente.lignes.map((l) => ({
      entite: 'ligneVente' as const,
      id: l.id,
      boutiqueId,
      donnees: versLigneVente(l),
    })),
    ...vente.paiements.map((p) => ({
      entite: 'paiementVente' as const,
      id: p.id,
      boutiqueId,
      donnees: versPaiementVente(p),
    })),
  ];
}

/**
 * Vente au comptant. Le serveur refait tous les contrôles : prix de gros justifié,
 * remise dans le plafond (ou validée par un gérant), paiements suffisants, téléphones
 * encore disponibles (sinon conflit, signalé au gérant). Le prix saisi sur l'appareil
 * est celui payé par le client : s'il diffère du prix actuel, l'écart est audité.
 */
export async function enregistrerVente(
  { tx, utilisateur, operation, journal, audit, autorisations }: ContexteOperation,
  d: VenteSaisie,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  if (await tx.vente.findUnique({ where: { id: d.id } })) return rejet('Identifiant déjà utilisé.');
  if (await tx.vente.findFirst({ where: { boutiqueId, numero: d.numero } })) {
    return rejet(`Le numéro de facture ${d.numero} est déjà utilisé.`);
  }
  const ids = [...d.lignes.map((l) => l.id), ...d.paiements.map((p) => p.id)];
  if (
    (await tx.ligneVente.count({ where: { id: { in: d.lignes.map((l) => l.id) } } })) ||
    (await tx.paiement.count({ where: { id: { in: d.paiements.map((p) => p.id) } } })) ||
    new Set(ids).size !== ids.length
  ) {
    return rejet('Identifiant de ligne déjà utilisé.');
  }

  const client = d.clientId
    ? await tx.client.findFirst({ where: { id: d.clientId, commerceId } })
    : null;
  if (d.clientId && !client) return rejet('Client inconnu.');

  const produits = await tx.produit.findMany({
    where: { id: { in: d.lignes.map((l) => l.produitId) }, commerceId },
    include: { prixBoutiques: { where: { boutiqueId } } },
  });
  const quantiteParProduit = new Map<string, number>();
  for (const l of d.lignes) {
    quantiteParProduit.set(l.produitId, (quantiteParProduit.get(l.produitId) ?? 0) + l.quantite);
  }
  const ecartsPrix: { produit: string; tarif: string; saisi: number; actuel: number }[] = [];
  for (const l of d.lignes) {
    const produit = produits.find((p) => p.id === l.produitId);
    if (!produit) return rejet('Un des produits est inconnu.');
    if (produit.type === 'TELEPHONE' && (!l.articleId || l.quantite !== 1)) {
      return rejet(`« ${produit.nom} » : un téléphone se vend à l’unité, avec son IMEI.`);
    }
    if (produit.type === 'ACCESSOIRE' && l.articleId) {
      return rejet(`« ${produit.nom} » : un accessoire se vend en quantité.`);
    }
    const prixBoutique = produit.prixBoutiques[0];
    const seuil = produit.seuilGros;
    if (
      l.tarif === 'GROS' &&
      client?.type !== 'GROSSISTE' &&
      (seuil === null || (quantiteParProduit.get(produit.id) ?? 0) < seuil)
    ) {
      return rejet(
        `« ${produit.nom} » : prix de gros réservé aux grossistes ou à partir de ${seuil ?? '—'} pièces.`,
      );
    }
    const actuel = Number(
      l.tarif === 'GROS'
        ? (prixBoutique?.prixGros ?? produit.prixGros)
        : (prixBoutique?.prixDetail ?? produit.prixDetail),
    );
    if (actuel !== l.prixUnitaire) {
      ecartsPrix.push({ produit: produit.nom, tarif: l.tarif, saisi: l.prixUnitaire, actuel });
    }
  }

  const { sousTotal, total } = totauxVente(d.lignes, d.remise);
  const commerce = await tx.commerce.findUniqueOrThrow({ where: { id: commerceId } });
  const dateVente = new Date(d.dateVente);
  const autorisation = await autorisations.plafondAutorise(
    d.autorisationRemise,
    commerceId,
    boutiqueId,
    dateVente,
  );
  const erreur = erreurRemise(
    d.remise,
    sousTotal,
    plafondRemise(utilisateur.role, commerce),
    autorisation?.plafond ?? null,
  );
  if (erreur) return rejet(erreur);
  const paiements = controlerPaiements(total, d.paiements);
  if (!paiements.ok) return rejet(paiements.motif);

  // Téléphones encore disponibles dans cette boutique (premier arrivé, premier servi).
  const articles = await tx.article.findMany({
    where: { id: { in: d.lignes.flatMap((l) => (l.articleId ? [l.articleId] : [])) }, commerceId },
  });
  for (const l of d.lignes) {
    if (!l.articleId) continue;
    const article = articles.find((a) => a.id === l.articleId) ?? null;
    if (article && article.produitId !== l.produitId)
      return rejet('Téléphone et produit ne correspondent pas.');
    const controle = controlerSortieArticle(article, boutiqueId);
    if (!controle.ok)
      return { ...controle, motif: `IMEI ${article?.imei ?? '?'} : ${controle.motif}` };
  }

  // Écritures.
  await tx.vente.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      numero: d.numero,
      clientId: d.clientId,
      vendeurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      mode: 'COMPTANT',
      sousTotal,
      remise: d.remise,
      total,
      montantPaye: total,
      renduMonnaie: paiements.rendu,
      dateVente,
      creeParId: utilisateur.id,
    },
  });
  const changements: NouveauChangement[] = [];
  for (const l of d.lignes) {
    const produit = produits.find((p) => p.id === l.produitId)!;
    const article = articles.find((a) => a.id === l.articleId);
    const coutUnitaire = article
      ? article.prixAchat
      : (produit.prixBoutiques[0]?.prixAchat ?? produit.prixAchat);
    await tx.ligneVente.create({
      data: {
        id: l.id,
        venteId: d.id,
        produitId: l.produitId,
        articleId: l.articleId,
        quantite: l.quantite,
        tarif: l.tarif,
        prixUnitaire: l.prixUnitaire,
        total: l.quantite * l.prixUnitaire,
        prixAchat: coutUnitaire,
        finGarantie: finGarantie(dateVente, produit.garantieMois),
      },
    });
    if (article) {
      const vendu = await tx.article.update({
        where: { id: article.id },
        data: { statut: 'VENDU' },
      });
      changements.push({
        entite: 'article',
        id: vendu.id,
        boutiqueId,
        donnees: versArticle(vendu),
      });
    }
    const stock = await tx.stock.upsert({
      where: { produitId_boutiqueId: { produitId: l.produitId, boutiqueId } },
      create: { produitId: l.produitId, boutiqueId, quantite: -l.quantite },
      update: { quantite: { decrement: l.quantite } },
    });
    changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
    await tx.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId,
        produitId: l.produitId,
        articleId: l.articleId,
        type: 'VENTE',
        quantite: -l.quantite,
        referenceType: 'Vente',
        referenceId: d.id,
        utilisateurId: utilisateur.id,
      },
    });
  }
  await tx.paiement.createMany({
    data: d.paiements.map((p) => ({ ...p, reference: p.reference?.trim() || null, venteId: d.id })),
  });
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsVente(tx, d.id))]);

  if (d.remise > 0) {
    await audit.journaliser(
      {
        commerceId,
        boutiqueId,
        action: ACTIONS_AUDIT.REMISE_ACCORDEE,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        entite: 'Vente',
        entiteId: d.id,
        details: {
          numero: d.numero,
          remise: d.remise,
          pourcentage: pourcentageRemise(d.remise, sousTotal),
          autorisePar: autorisation?.gerantId ?? null,
        },
      },
      tx,
    );
  }
  if (ecartsPrix.length) {
    await audit.journaliser(
      {
        commerceId,
        boutiqueId,
        action: ACTIONS_AUDIT.ECART_PRIX,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        entite: 'Vente',
        entiteId: d.id,
        details: { numero: d.numero, ecarts: ecartsPrix },
      },
      tx,
    );
  }
  return OK;
}

/**
 * Annulation d'une vente (gérant ou propriétaire, avec motif) : les téléphones et
 * accessoires reviennent en stock. Une vente déjà annulée reste annulée.
 */
export async function annulerVente(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: { venteId: string; motif: string },
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const vente = await tx.vente.findFirst({
    where: { id: d.venteId, commerceId, boutiqueId },
    include: { lignes: { include: { article: true } }, retours: true, credit: true },
  });
  if (!vente) return rejet('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') return OK;
  if (vente.retours.length)
    return conflit('Cette vente a déjà fait l’objet d’un retour : traitez-la par un retour.');
  if (vente.credit) return conflit('Cette vente est à crédit : annulez plutôt le crédit.');

  await tx.vente.update({
    where: { id: vente.id },
    data: {
      statut: 'ANNULEE',
      annuleLe: new Date(),
      annuleParId: utilisateur.id,
      motifAnnulation: d.motif,
    },
  });
  const changements: NouveauChangement[] = [];
  for (const l of vente.lignes) {
    if (l.article) {
      if (l.article.statut !== 'VENDU') continue;
      const remis = await tx.article.update({
        where: { id: l.article.id },
        data: { statut: 'EN_STOCK' },
      });
      changements.push({
        entite: 'article',
        id: remis.id,
        boutiqueId,
        donnees: versArticle(remis),
      });
    }
    const stock = await tx.stock.update({
      where: { produitId_boutiqueId: { produitId: l.produitId, boutiqueId } },
      data: { quantite: { increment: l.quantite } },
    });
    changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
    await tx.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId,
        produitId: l.produitId,
        articleId: l.articleId,
        type: 'ANNULATION_VENTE',
        quantite: l.quantite,
        motif: d.motif,
        referenceType: 'Vente',
        referenceId: vente.id,
        utilisateurId: utilisateur.id,
      },
    });
  }
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsVente(tx, vente.id))]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.VENTE_ANNULEE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Vente',
      entiteId: vente.id,
      details: { numero: vente.numero, total: Number(vente.total), motif: d.motif },
    },
    tx,
  );
  return OK;
}
