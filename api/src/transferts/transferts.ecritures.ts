import {
  bilanReception,
  type ContenuOperation,
  type Controle,
  controlerSortieArticle,
  erreurBoutiquesTransfert,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import { BOUTIQUE_OUVERTE } from '../auth/acces.regles.js';
import { Role } from '../generated/prisma/enums.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import {
  versArticle,
  versLigneTransfert,
  versStock,
  versTransfert,
} from '../sync/serialisation.js';

type Refus = Extract<Controle, { ok: false }>;
const OK: Controle = { ok: true };
const rejet = (motif: string): Refus => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Refus => ({ ok: false, statut: 'CONFLIT', motif });

/** Le transfert et ses lignes, pour les appareils des deux boutiques. */
export async function changementsTransfert(tx: Tx, id: string): Promise<NouveauChangement[]> {
  const t = await tx.transfert.findUniqueOrThrow({
    where: { id },
    include: { lignes: { include: { article: { select: { imei: true } } } } },
  });
  return [...new Set([t.boutiqueDepartId, t.boutiqueArriveeId])].flatMap((boutiqueId) => [
    { entite: 'transfert' as const, id: t.id, boutiqueId, donnees: versTransfert(t) },
    ...t.lignes.map((l) => ({
      entite: 'ligneTransfert' as const,
      id: l.id,
      boutiqueId,
      donnees: versLigneTransfert(l),
    })),
  ]);
}

/** Boutique du commerce, ouverte (ni verrouillée ni supprimée). */
async function boutiqueOuverte(tx: Tx, commerceId: string, id: string) {
  return tx.boutique.findFirst({ where: { id, commerceId, ...BOUTIQUE_OUVERTE } });
}

/** Demande de stock par la boutique qui reçoit (boutique de l'opération). */
export async function demanderTransfert(
  { tx, utilisateur, operation, journal }: ContexteOperation,
  d: ContenuOperation<'TRANSFERT_DEMANDER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const arriveeId = operation.boutiqueId;
  const erreur = erreurBoutiquesTransfert(d.boutiqueDepartId, arriveeId);
  if (erreur) return rejet(erreur);
  if (!(await boutiqueOuverte(tx, commerceId, d.boutiqueDepartId))) {
    return rejet('Boutique de départ inconnue ou fermée.');
  }
  if (await tx.transfert.findUnique({ where: { id: d.id } }))
    return rejet('Transfert déjà enregistré.');
  if (await tx.transfert.findFirst({ where: { commerceId, numero: d.numero } })) {
    return rejet(`Le numéro ${d.numero} est déjà utilisé.`);
  }
  const produits = await tx.produit.count({
    where: { id: { in: d.lignes.map((l) => l.produitId) }, commerceId },
  });
  if (produits !== new Set(d.lignes.map((l) => l.produitId)).size) {
    return rejet('Un des produits est inconnu.');
  }
  await tx.transfert.create({
    data: {
      id: d.id,
      commerceId,
      numero: d.numero,
      boutiqueDepartId: d.boutiqueDepartId,
      boutiqueArriveeId: arriveeId,
      note: d.note,
      creeParId: utilisateur.id,
      lignes: {
        create: d.lignes.map((l) => ({ id: l.id, produitId: l.produitId, quantite: l.quantite })),
      },
    },
  });
  await journal.ecrire(tx, commerceId, await changementsTransfert(tx, d.id));
  return OK;
}

/**
 * Envoi par la boutique de départ : prépare une demande (ses lignes sont remplacées
 * par ce qui part réellement) ou, pour le propriétaire, envoi direct. Les téléphones
 * passent EN_TRANSFERT et le stock de départ diminue aussitôt.
 */
export async function envoyerTransfert(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'TRANSFERT_ENVOYER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const departId = operation.boutiqueId;
  const erreur = erreurBoutiquesTransfert(departId, d.boutiqueArriveeId);
  if (erreur) return rejet(erreur);
  if (!(await boutiqueOuverte(tx, commerceId, d.boutiqueArriveeId))) {
    return rejet('Boutique d’arrivée inconnue ou fermée.');
  }
  const existant = await tx.transfert.findUnique({ where: { id: d.id } });
  if (existant) {
    if (existant.commerceId !== commerceId || existant.boutiqueDepartId !== departId) {
      return rejet('Ce transfert ne part pas de cette boutique.');
    }
    if (existant.boutiqueArriveeId !== d.boutiqueArriveeId) {
      return rejet('La boutique d’arrivée ne correspond pas à la demande.');
    }
    if (existant.statut !== 'DEMANDE') {
      return conflit(
        existant.statut === 'ANNULE'
          ? 'Cette demande a été annulée.'
          : 'Ce transfert est déjà parti.',
      );
    }
  } else {
    if (utilisateur.role !== Role.PROPRIETAIRE) {
      return rejet('Seul le propriétaire envoie sans demande ; sinon, préparez une demande reçue.');
    }
    if (await tx.transfert.findFirst({ where: { commerceId, numero: d.numero } })) {
      return rejet(`Le numéro ${d.numero} est déjà utilisé.`);
    }
  }
  const nouvellesLignes = d.lignes.map((l) => l.id);
  if (
    await tx.ligneTransfert.count({
      where: { id: { in: nouvellesLignes }, NOT: { transfertId: d.id } },
    })
  ) {
    return rejet('Identifiant de ligne déjà utilisé.');
  }

  // Contrôles : produits, téléphones encore en stock au départ, quantités disponibles.
  const produits = await tx.produit.findMany({
    where: { id: { in: d.lignes.map((l) => l.produitId) }, commerceId },
  });
  const articles = await tx.article.findMany({
    where: { id: { in: d.lignes.flatMap((l) => (l.articleId ? [l.articleId] : [])) }, commerceId },
  });
  const besoins = new Map<string, number>();
  for (const l of d.lignes) {
    const produit = produits.find((p) => p.id === l.produitId);
    if (!produit) return rejet('Un des produits est inconnu.');
    if ((produit.type === 'TELEPHONE') !== (l.articleId !== null)) {
      return rejet(
        `« ${produit.nom} » : un téléphone part avec son IMEI, un accessoire en quantité.`,
      );
    }
    if (l.articleId) {
      const article = articles.find((a) => a.id === l.articleId) ?? null;
      if (article && article.produitId !== l.produitId) {
        return rejet('Téléphone et produit ne correspondent pas.');
      }
      const controle = controlerSortieArticle(article, departId);
      if (!controle.ok)
        return { ...controle, motif: `IMEI ${article?.imei ?? '?'} : ${controle.motif}` };
    } else {
      besoins.set(l.produitId, (besoins.get(l.produitId) ?? 0) + l.quantite);
    }
  }
  for (const [produitId, quantite] of besoins) {
    const stock = await tx.stock.findUnique({
      where: { produitId_boutiqueId: { produitId, boutiqueId: departId } },
    });
    if ((stock?.quantite ?? 0) < quantite) {
      const nom = produits.find((p) => p.id === produitId)!.nom;
      return conflit(`« ${nom} » : ${stock?.quantite ?? 0} en stock seulement au départ.`);
    }
  }

  // Écritures.
  const maintenant = new Date();
  const changements: NouveauChangement[] = [];
  if (existant) {
    // Lignes de la demande remplacées par ce qui part : les anciennes quittent les appareils.
    const anciennes = await tx.ligneTransfert.findMany({
      where: { transfertId: d.id, NOT: { id: { in: nouvellesLignes } } },
      select: { id: true },
    });
    for (const boutique of [departId, d.boutiqueArriveeId]) {
      for (const a of anciennes) {
        changements.push({
          entite: 'ligneTransfert',
          id: a.id,
          boutiqueId: boutique,
          donnees: null,
        });
      }
    }
    await tx.ligneTransfert.deleteMany({ where: { transfertId: d.id } });
    await tx.transfert.update({
      where: { id: d.id },
      data: {
        statut: 'ENVOYE',
        envoyeLe: maintenant,
        envoyeParId: utilisateur.id,
        note: d.note ?? existant.note,
      },
    });
  } else {
    await tx.transfert.create({
      data: {
        id: d.id,
        commerceId,
        numero: d.numero,
        boutiqueDepartId: departId,
        boutiqueArriveeId: d.boutiqueArriveeId,
        statut: 'ENVOYE',
        note: d.note,
        envoyeLe: maintenant,
        envoyeParId: utilisateur.id,
        creeParId: utilisateur.id,
      },
    });
  }
  await tx.ligneTransfert.createMany({
    data: d.lignes.map((l) => ({
      id: l.id,
      transfertId: d.id,
      produitId: l.produitId,
      articleId: l.articleId,
      quantite: l.quantite,
    })),
  });
  for (const l of d.lignes) {
    if (l.articleId) {
      const article = await tx.article.update({
        where: { id: l.articleId },
        data: { statut: 'EN_TRANSFERT' },
      });
      changements.push({
        entite: 'article',
        id: article.id,
        boutiqueId: departId,
        donnees: versArticle(article),
      });
    }
    const stock = await tx.stock.update({
      where: { produitId_boutiqueId: { produitId: l.produitId, boutiqueId: departId } },
      data: { quantite: { decrement: l.quantite } },
    });
    changements.push({
      entite: 'stock',
      id: stock.id,
      boutiqueId: departId,
      donnees: versStock(stock),
    });
    await tx.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId: departId,
        produitId: l.produitId,
        articleId: l.articleId,
        type: 'TRANSFERT_SORTIE',
        quantite: -l.quantite,
        referenceType: 'Transfert',
        referenceId: d.id,
        utilisateurId: utilisateur.id,
      },
    });
  }
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsTransfert(tx, d.id))]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId: departId,
      action: ACTIONS_AUDIT.TRANSFERT_ENVOYE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Transfert',
      entiteId: d.id,
      details: {
        numero: d.numero,
        vers: d.boutiqueArriveeId,
        direct: !existant,
        telephones: d.lignes.filter((l) => l.articleId).length,
        accessoires: [...besoins.values()].reduce((t, q) => t + q, 0),
      },
    },
    tx,
  );
  return OK;
}

/**
 * Réception par scan à l'arrivée : seuls les téléphones scannés et les quantités
 * comptées entrent dans le stock d'arrivée ; les écarts sont journalisés (les
 * téléphones manquants restent EN_TRANSFERT, à retrouver).
 */
export async function recevoirTransfert(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'TRANSFERT_RECEVOIR'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const arriveeId = operation.boutiqueId;
  const t = await tx.transfert.findFirst({
    where: { id: d.transfertId, commerceId },
    include: { lignes: true },
  });
  if (!t || t.boutiqueArriveeId !== arriveeId)
    return rejet('Transfert introuvable pour cette boutique.');
  if (t.statut === 'RECU') return conflit('Ce transfert a déjà été reçu.');
  if (t.statut !== 'ENVOYE') {
    return conflit(
      t.statut === 'ANNULE' ? 'Ce transfert a été annulé.' : 'Ce transfert n’est pas encore parti.',
    );
  }
  const bilan = bilanReception(t.lignes, d);
  const recuLe = new Date(d.recuLe);
  const changements: NouveauChangement[] = [];
  for (const l of t.lignes) {
    const recu = bilan.recues.find((r) => r.ligneId === l.id)!.quantite;
    await tx.ligneTransfert.update({ where: { id: l.id }, data: { quantiteRecue: recu } });
    if (recu === 0) continue;
    if (l.articleId) {
      const article = await tx.article.update({
        where: { id: l.articleId },
        data: { statut: 'EN_STOCK', boutiqueId: arriveeId },
      });
      // Le téléphone quitte les appareils du départ, puis arrive chez ceux de l'arrivée.
      changements.push(
        { entite: 'article', id: article.id, boutiqueId: t.boutiqueDepartId, donnees: null },
        { entite: 'article', id: article.id, boutiqueId: arriveeId, donnees: versArticle(article) },
      );
    }
    const stock = await tx.stock.upsert({
      where: { produitId_boutiqueId: { produitId: l.produitId, boutiqueId: arriveeId } },
      create: { produitId: l.produitId, boutiqueId: arriveeId, quantite: recu },
      update: { quantite: { increment: recu } },
    });
    changements.push({
      entite: 'stock',
      id: stock.id,
      boutiqueId: arriveeId,
      donnees: versStock(stock),
    });
    await tx.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId: arriveeId,
        produitId: l.produitId,
        articleId: l.articleId,
        type: 'TRANSFERT_ENTREE',
        quantite: recu,
        referenceType: 'Transfert',
        referenceId: t.id,
        utilisateurId: utilisateur.id,
      },
    });
  }
  await tx.transfert.update({
    where: { id: t.id },
    data: { statut: 'RECU', recuLe, recuParId: utilisateur.id, noteReception: d.note },
  });
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsTransfert(tx, t.id))]);
  const base = {
    commerceId,
    boutiqueId: arriveeId,
    utilisateurId: utilisateur.id,
    appareilId: utilisateur.appareilId,
    entite: 'Transfert',
    entiteId: t.id,
  };
  await audit.journaliser(
    { ...base, action: ACTIONS_AUDIT.TRANSFERT_RECU, details: { numero: t.numero } },
    tx,
  );
  if (bilan.ecarts.length || bilan.inattendus.length) {
    await audit.journaliser(
      {
        ...base,
        action: ACTIONS_AUDIT.TRANSFERT_ECART,
        details: {
          numero: t.numero,
          ecarts: bilan.ecarts,
          inattendus: bilan.inattendus,
          note: d.note,
        },
      },
      tx,
    );
  }
  return OK;
}

/**
 * Annulation : une demande (par l'une ou l'autre boutique), ou un envoi pas encore
 * reçu (par le départ : téléphones et quantités reviennent en stock).
 */
export async function annulerTransfert(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'TRANSFERT_ANNULER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const t = await tx.transfert.findFirst({
    where: { id: d.transfertId, commerceId },
    include: { lignes: true },
  });
  const boutiqueId = operation.boutiqueId;
  if (!t || (t.boutiqueDepartId !== boutiqueId && t.boutiqueArriveeId !== boutiqueId)) {
    return rejet('Transfert introuvable pour cette boutique.');
  }
  if (t.statut === 'ANNULE') return OK;
  if (t.statut === 'RECU') return conflit('Ce transfert a déjà été reçu.');
  if (t.statut === 'ENVOYE' && boutiqueId !== t.boutiqueDepartId) {
    return rejet('Un transfert parti s’annule depuis la boutique de départ.');
  }
  const changements: NouveauChangement[] = [];
  if (t.statut === 'ENVOYE') {
    for (const l of t.lignes) {
      if (l.articleId) {
        const article = await tx.article.update({
          where: { id: l.articleId },
          data: { statut: 'EN_STOCK' },
        });
        changements.push({
          entite: 'article',
          id: article.id,
          boutiqueId,
          donnees: versArticle(article),
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
          type: 'TRANSFERT_ENTREE',
          quantite: l.quantite,
          motif: `Annulation : ${d.motif}`,
          referenceType: 'Transfert',
          referenceId: t.id,
          utilisateurId: utilisateur.id,
        },
      });
    }
  }
  await tx.transfert.update({
    where: { id: t.id },
    data: { statut: 'ANNULE', motifAnnulation: d.motif },
  });
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsTransfert(tx, t.id))]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.TRANSFERT_ANNULE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Transfert',
      entiteId: t.id,
      details: { numero: t.numero, etait: t.statut, motif: d.motif },
    },
    tx,
  );
  return OK;
}
