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
  type VenteEchangeSaisie,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import { caisseDeRattachement } from '../caisse/caisse.ecritures.js';
import { controlerTroc, ecrireTroc } from '../trocs/troc.ecritures.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import {
  versArticle,
  versClient,
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
 * `reprise` : valeur des articles rendus lors d'un échange, déduite du total.
 * Un paiement « Avoir » est pris sur le solde d'avoir du client. Un troc joint
 * (ancien téléphone du client) s'ajoute à la reprise et entre en stock.
 */
export async function enregistrerVente(
  ctx: ContexteOperation,
  d: VenteSaisie | VenteEchangeSaisie,
  reprise = 0,
): Promise<Controle> {
  const { tx, utilisateur, operation, journal, audit, autorisations } = ctx;
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
  const articles = await tx.article.findMany({
    where: { id: { in: d.lignes.flatMap((l) => (l.articleId ? [l.articleId] : [])) }, commerceId },
  });
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
    // Un téléphone revendu d'occasion a son propre prix.
    const prixOccasion = articles.find((a) => a.id === l.articleId)?.prixRevente;
    const actuel = Number(
      prixOccasion ??
        (l.tarif === 'GROS'
          ? (prixBoutique?.prixGros ?? produit.prixGros)
          : (prixBoutique?.prixDetail ?? produit.prixDetail)),
    );
    if (actuel !== l.prixUnitaire) {
      ecartsPrix.push({ produit: produit.nom, tarif: l.tarif, saisi: l.prixUnitaire, actuel });
    }
  }

  const { sousTotal, total: avantReprise } = totauxVente(d.lignes, d.remise);
  // Troc : la valeur de l'ancien téléphone règle une partie de la vente.
  const repriseTotale = reprise + (d.troc?.valeurRetenue ?? 0);
  if (repriseTotale > avantReprise) return rejet('La reprise dépasse le montant de la vente.');
  const total = avantReprise - repriseTotale;
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
  const avoirUtilise = d.paiements
    .filter((p) => p.moyen === 'AVOIR')
    .reduce((t, p) => t + p.montant, 0);
  if (avoirUtilise > 0) {
    if (!client) return rejet('Un avoir se paie au nom du client : choisissez-le.');
    if (Number(client.soldeAvoir) < avoirUtilise) {
      return conflit(
        `Avoir insuffisant : le solde de ${client.nom} est de ${Number(client.soldeAvoir)}.`,
      );
    }
  }

  // Téléphones encore disponibles dans cette boutique (premier arrivé, premier servi).
  for (const l of d.lignes) {
    if (!l.articleId) continue;
    const article = articles.find((a) => a.id === l.articleId) ?? null;
    if (article && article.produitId !== l.produitId)
      return rejet('Téléphone et produit ne correspondent pas.');
    const controle = controlerSortieArticle(article, boutiqueId);
    if (!controle.ok)
      return { ...controle, motif: `IMEI ${article?.imei ?? '?'} : ${controle.motif}` };
  }

  const troc = d.troc ? await controlerTroc(ctx, d.troc, client, dateVente) : null;
  if (troc && !troc.ok) return troc;

  // Écritures (rattachées à la caisse ouverte du vendeur).
  const caisseId = await caisseDeRattachement(tx, d.caisseId, utilisateur, boutiqueId);
  await tx.vente.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      numero: d.numero,
      clientId: d.clientId,
      vendeurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      caisseId,
      mode: 'COMPTANT',
      sousTotal,
      remise: d.remise,
      reprise: repriseTotale,
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
  if (avoirUtilise > 0 && client) {
    const debite = await tx.client.update({
      where: { id: client.id },
      data: { soldeAvoir: { decrement: avoirUtilise } },
    });
    changements.push({
      entite: 'client',
      id: debite.id,
      boutiqueId: null,
      donnees: versClient(debite),
    });
  }
  if (troc?.ok && client) changements.push(...(await ecrireTroc(ctx, troc.troc, d.id, client.id)));
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
    include: {
      lignes: { include: { article: true } },
      paiements: true,
      retours: true,
      echanges: true,
      credit: true,
      troc: true,
    },
  });
  if (!vente) return rejet('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') return OK;
  if (vente.retours.length)
    return conflit('Cette vente a déjà fait l’objet d’un retour : traitez-la par un retour.');
  if (vente.credit) return conflit('Cette vente est à crédit : annulez plutôt le crédit.');
  if (vente.troc) {
    return conflit(
      'Vente avec un troc : le téléphone repris est en stock, traitez-la par un retour.',
    );
  }
  if (vente.echanges.length) {
    return conflit('Vente issue d’un échange : traitez-la par un nouveau retour.');
  }

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
  // L'avoir utilisé revient au client.
  const avoirUtilise = vente.paiements
    .filter((p) => p.moyen === 'AVOIR')
    .reduce((t, p) => t + Number(p.montant), 0);
  if (avoirUtilise > 0 && vente.clientId) {
    const credite = await tx.client.update({
      where: { id: vente.clientId },
      data: { soldeAvoir: { increment: avoirUtilise } },
    });
    changements.push({
      entite: 'client',
      id: credite.id,
      boutiqueId: null,
      donnees: versClient(credite),
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
