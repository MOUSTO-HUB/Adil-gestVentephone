import {
  type ContenuOperation,
  type Controle,
  erreurClientTroc,
  erreurReprise,
  etatGlobal,
  LIBELLES_MOTIFS_IMEI,
  plafondReprise,
  type TrocSaisi,
  valeurProposee,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import type { Article, Client, Produit } from '../generated/prisma/client.js';
import type { NouveauChangement } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import {
  versArticle,
  versGrilleReprise,
  versImeiSignale,
  versStock,
  versTroc,
} from '../sync/serialisation.js';

type Refus = Extract<Controle, { ok: false }>;
const OK: Controle = { ok: true };
const rejet = (motif: string): Refus => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Refus => ({ ok: false, statut: 'CONFLIT', motif });

/** Troc contrôlé, prêt à être écrit avec la vente. */
export interface TrocControle {
  saisie: TrocSaisi;
  produit: Produit;
  /** Article déjà connu du commerce (téléphone vendu autrefois), repris tel quel. */
  existant: Article | null;
  proposee: number;
  autorisePar: string | null;
}

/**
 * Contrôles du troc joint à une vente : fiche client avec pièce d'identité, appareil
 * du catalogue, IMEI ni signalé volé ou bloqué ni déjà en stock, valeur retenue dans
 * la limite du vendeur (ou validée par un gérant). Rien n'est écrit.
 */
export async function controlerTroc(
  { tx, utilisateur, operation, autorisations }: ContexteOperation,
  t: TrocSaisi,
  client: Client | null,
  dateVente: Date,
): Promise<{ ok: true; troc: TrocControle } | Refus> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const erreurClient = erreurClientTroc(client);
  if (erreurClient) return rejet(erreurClient);
  if (await tx.troc.findUnique({ where: { id: t.id } })) {
    return rejet('Identifiant de troc déjà utilisé.');
  }
  const produit = await tx.produit.findFirst({
    where: { id: t.produitId, commerceId },
    include: { prixBoutiques: { where: { boutiqueId } } },
  });
  if (!produit || produit.type !== 'TELEPHONE') {
    return rejet('Troc : choisissez le modèle de l’appareil repris parmi les téléphones.');
  }
  const signale = await tx.imeiSignale.findFirst({
    where: { commerceId, imei: t.imei, actif: true },
  });
  if (signale) {
    return conflit(
      `IMEI ${t.imei} signalé ${LIBELLES_MOTIFS_IMEI[signale.motif].toLowerCase()} : reprise refusée.`,
    );
  }
  const existant = await tx.article.findFirst({
    where: { commerceId, OR: [{ imei: t.imei }, { imei2: t.imei }] },
  });
  if (existant && existant.statut !== 'VENDU' && existant.statut !== 'REBUT') {
    return conflit(`IMEI ${t.imei} : ce téléphone est déjà dans le stock du commerce.`);
  }
  if (!existant && (await tx.article.findUnique({ where: { id: t.articleId } }))) {
    return rejet('Identifiant d’article déjà utilisé.');
  }

  // Valeur proposée recalculée ; la plus haute des deux (grille changée hors ligne) fait foi.
  const commerce = await tx.commerce.findUniqueOrThrow({ where: { id: commerceId } });
  const grille = produit.modeleId
    ? await tx.grilleReprise.findMany({ where: { commerceId, modeleId: produit.modeleId } })
    : [];
  const etat = etatGlobal({
    ecran: t.etatEcran,
    batterie: t.etatBatterie,
    boitier: t.etatBoitier,
    fonctionne: t.fonctionne,
  });
  const serveur = valeurProposee(
    grille.map((g) => ({ ...g, valeur: Number(g.valeur) })),
    {
      modeleId: produit.modeleId,
      capacite: produit.capacite,
      prixNeuf: Number(produit.prixBoutiques[0]?.prixDetail ?? produit.prixDetail),
    },
    etat,
  ).valeur;
  const proposee = Math.max(serveur, t.valeurProposee);
  const autorisation = await autorisations.repriseAutorisee(
    t.autorisation,
    commerceId,
    boutiqueId,
    t.id,
    dateVente,
  );
  const erreur = erreurReprise(
    t.valeurRetenue,
    plafondReprise(proposee, utilisateur.role, commerce.repriseMaxVendeur),
    autorisation?.valeur ?? null,
  );
  if (erreur) return rejet(erreur);
  return {
    ok: true,
    troc: { saisie: t, produit, existant, proposee, autorisePar: autorisation?.gerantId ?? null },
  };
}

/**
 * Écritures du troc après celles de la vente : l'appareil entre en stock (à réparer,
 * ou à revendre avec son prix d'occasion), coût = valeur retenue ; mouvement TROC_ENTREE.
 */
export async function ecrireTroc(
  { tx, utilisateur, operation, audit }: ContexteOperation,
  c: TrocControle,
  venteId: string,
  clientId: string,
): Promise<NouveauChangement[]> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const t = c.saisie;
  const donnees = {
    produitId: c.produit.id,
    boutiqueId,
    statut: t.destination === 'A_REPARER' ? ('A_REPARER' as const) : ('EN_STOCK' as const),
    origine: 'TROC' as const,
    prixAchat: t.valeurRetenue,
    prixRevente: t.prixRevente,
  };
  const article = c.existant
    ? await tx.article.update({ where: { id: c.existant.id }, data: donnees })
    : await tx.article.create({
        data: { ...donnees, id: t.articleId, commerceId, imei: t.imei, creeParId: utilisateur.id },
      });
  const changements: NouveauChangement[] = [
    { entite: 'article', id: article.id, boutiqueId, donnees: versArticle(article) },
  ];
  // Téléphone déjà connu : l'article provisoire créé sur l'appareil disparaît.
  if (article.id !== t.articleId) {
    changements.push({ entite: 'article', id: t.articleId, boutiqueId, donnees: null });
  }
  const stock = await tx.stock.upsert({
    where: { produitId_boutiqueId: { produitId: c.produit.id, boutiqueId } },
    create: { produitId: c.produit.id, boutiqueId, quantite: 1 },
    update: { quantite: { increment: 1 } },
  });
  changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
  await tx.mouvementStock.create({
    data: {
      commerceId,
      boutiqueId,
      produitId: c.produit.id,
      articleId: article.id,
      type: 'TROC_ENTREE',
      quantite: 1,
      motif: t.destination === 'A_REPARER' ? 'Repris, à réparer' : 'Repris, à revendre',
      referenceType: 'Troc',
      referenceId: t.id,
      utilisateurId: utilisateur.id,
    },
  });
  const etat = etatGlobal({
    ecran: t.etatEcran,
    batterie: t.etatBatterie,
    boitier: t.etatBoitier,
    fonctionne: t.fonctionne,
  });
  const troc = await tx.troc.create({
    data: {
      id: t.id,
      commerceId,
      boutiqueId,
      clientId,
      venteId,
      articleId: article.id,
      modeleId: c.produit.modeleId,
      note: t.note,
      imei: t.imei,
      etatEcran: t.etatEcran,
      etatBatterie: t.etatBatterie,
      etatBoitier: t.etatBoitier,
      fonctionne: t.fonctionne,
      etatGlobal: etat,
      photoCles: [],
      valeurProposee: c.proposee,
      valeurRetenue: t.valeurRetenue,
      ajustementParId: c.autorisePar,
      creeParId: utilisateur.id,
    },
  });
  changements.push({ entite: 'troc', id: troc.id, boutiqueId, donnees: versTroc(troc) });

  const base = {
    commerceId,
    boutiqueId,
    utilisateurId: utilisateur.id,
    appareilId: utilisateur.appareilId,
    entite: 'Troc',
    entiteId: t.id,
  };
  await audit.journaliser(
    {
      ...base,
      action: ACTIONS_AUDIT.TROC_ENREGISTRE,
      details: {
        venteId,
        imei: t.imei,
        produit: c.produit.nom,
        etat,
        valeur: t.valeurRetenue,
        destination: t.destination,
      },
    },
    tx,
  );
  if (t.valeurRetenue !== c.proposee) {
    await audit.journaliser(
      {
        ...base,
        action: ACTIONS_AUDIT.REPRISE_AJUSTEE,
        details: {
          proposee: c.proposee,
          retenue: t.valeurRetenue,
          validePar: c.autorisePar,
        },
      },
      tx,
    );
  }
  return changements;
}

/** Grille de reprise d'un modèle et d'une capacité : ses lignes sont remplacées (propriétaire). */
export async function enregistrerGrille(
  { tx, utilisateur, journal, audit }: ContexteOperation,
  d: ContenuOperation<'GRILLE_REPRISE_ENREGISTRER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  if (!(await tx.modele.findFirst({ where: { id: d.modeleId, commerceId } }))) {
    return rejet('Modèle inconnu.');
  }
  const ids = d.lignes.map((l) => l.id);
  const capacite = d.capacite?.trim() || null;
  const anciennes = await tx.grilleReprise.findMany({
    where: { commerceId, modeleId: d.modeleId, capacite },
  });
  if (
    await tx.grilleReprise.count({
      where: { id: { in: ids }, NOT: { id: { in: anciennes.map((a) => a.id) } } },
    })
  ) {
    return rejet('Identifiant de ligne déjà utilisé.');
  }
  await tx.grilleReprise.deleteMany({ where: { id: { in: anciennes.map((a) => a.id) } } });
  const nouvelles = await tx.grilleReprise.createManyAndReturn({
    data: d.lignes.map((l) => ({
      id: l.id,
      commerceId,
      modeleId: d.modeleId,
      capacite,
      etat: l.etat,
      valeur: l.valeur,
      creeParId: utilisateur.id,
    })),
  });
  await journal.ecrire(tx, commerceId, [
    ...anciennes
      .filter((a) => !ids.includes(a.id))
      .map((a) => ({
        entite: 'grilleReprise' as const,
        id: a.id,
        boutiqueId: null,
        donnees: null,
      })),
    ...nouvelles.map((g) => ({
      entite: 'grilleReprise' as const,
      id: g.id,
      boutiqueId: null,
      donnees: versGrilleReprise(g),
    })),
  ]);
  await audit.journaliser(
    {
      commerceId,
      action: ACTIONS_AUDIT.GRILLE_REPRISE_MODIFIEE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Modele',
      entiteId: d.modeleId,
      details: {
        capacite,
        avant: anciennes.map((a) => ({ etat: a.etat, valeur: Number(a.valeur) })),
        apres: d.lignes.map((l) => ({ etat: l.etat, valeur: l.valeur })),
      },
    },
    tx,
  );
  return OK;
}

/** IMEI signalé volé ou bloqué, ou signalement levé (gérant, propriétaire). */
export async function signalerImei(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'IMEI_SIGNALER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const parImei = await tx.imeiSignale.findUnique({
    where: { commerceId_imei: { commerceId, imei: d.imei } },
  });
  if (parImei && parImei.id !== d.id) {
    return conflit(`L’IMEI ${d.imei} est déjà dans la liste : modifiez son signalement.`);
  }
  const autre = await tx.imeiSignale.findUnique({ where: { id: d.id } });
  if (autre && autre.commerceId !== commerceId) return rejet('Identifiant déjà utilisé.');
  const donnees = { imei: d.imei, motif: d.motif, note: d.note?.trim() || null, actif: d.actif };
  const signale = await tx.imeiSignale.upsert({
    where: { id: d.id },
    create: { ...donnees, id: d.id, commerceId, creeParId: utilisateur.id },
    update: donnees,
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'imeiSignale', id: signale.id, boutiqueId: null, donnees: versImeiSignale(signale) },
  ]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId: operation.boutiqueId,
      action: ACTIONS_AUDIT.IMEI_SIGNALE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'ImeiSignale',
      entiteId: signale.id,
      details: donnees,
    },
    tx,
  );
  return OK;
}

/** Appareil repris réparé : remis en vente d'occasion à son prix (gérant, propriétaire). */
export async function remettreEnVente(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'ARTICLE_REMETTRE_EN_VENTE'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const article = await tx.article.findFirst({
    where: { id: d.articleId, commerceId, boutiqueId: operation.boutiqueId },
  });
  if (!article) return rejet('Téléphone introuvable dans cette boutique.');
  if (article.statut !== 'A_REPARER') {
    return conflit(`IMEI ${article.imei} : n’est plus enregistré « à réparer ».`);
  }
  const remis = await tx.article.update({
    where: { id: article.id },
    data: { statut: 'EN_STOCK', prixRevente: d.prixRevente },
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'article', id: remis.id, boutiqueId: remis.boutiqueId, donnees: versArticle(remis) },
  ]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId: operation.boutiqueId,
      action: ACTIONS_AUDIT.REMISE_EN_VENTE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Article',
      entiteId: article.id,
      details: { imei: article.imei, prixRevente: d.prixRevente },
    },
    tx,
  );
  return OK;
}
