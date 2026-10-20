import {
  bilanRetour,
  type Controle,
  erreurConditionsRetour,
  erreurDestination,
  LIBELLES_DESTINATIONS,
  LIBELLES_MOYENS,
  moyenAvecReference,
  quantiteRetournable,
  type RetourSaisi,
  totauxVente,
  valeurRetour,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import { Role } from '../generated/prisma/enums.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import {
  versArticle,
  versClient,
  versLigneRetour,
  versRetour,
  versStock,
} from '../sync/serialisation.js';
import { enregistrerVente } from '../ventes/ventes.ecritures.js';

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Controle => ({ ok: false, statut: 'CONFLIT', motif });

/** Marge tolérée sur l'horloge de l'appareil. */
const MARGE_HORLOGE_MS = 5 * 60 * 1000;

export async function changementsRetour(tx: Tx, retourId: string): Promise<NouveauChangement[]> {
  const retour = await tx.retour.findUniqueOrThrow({
    where: { id: retourId },
    include: { lignes: true },
  });
  const boutiqueId = retour.boutiqueId;
  return [
    { entite: 'retour', id: retour.id, boutiqueId, donnees: versRetour(retour) },
    ...retour.lignes.map((l) => ({
      entite: 'ligneRetour' as const,
      id: l.id,
      boutiqueId,
      donnees: versLigneRetour(l),
    })),
  ];
}

/**
 * Retour (remboursement ou avoir) ou échange d'articles d'une vente. Réservé au
 * gérant et au propriétaire ; un vendeur joint le jeton obtenu avec le PIN du gérant.
 * Conditions du commerce (délai, état, garantie) ; chaque article rendu revient en
 * stock (neuf ou d'occasion) ou part au rebut. L'échange crée une nouvelle vente
 * réglée d'abord par la valeur des articles rendus.
 */
export async function enregistrerRetour(ctx: ContexteOperation, d: RetourSaisi): Promise<Controle> {
  const { tx, utilisateur, operation, journal, audit, autorisations } = ctx;
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;

  if (await tx.retour.findUnique({ where: { id: d.id } }))
    return rejet('Identifiant déjà utilisé.');
  const ids = d.lignes.map((l) => l.id);
  if (
    new Set(ids).size !== ids.length ||
    (await tx.ligneRetour.count({ where: { id: { in: ids } } }))
  ) {
    return rejet('Identifiant de ligne déjà utilisé.');
  }
  const vente = await tx.vente.findFirst({
    where: { id: d.venteId, commerceId, boutiqueId },
    include: {
      lignes: { include: { produit: true, article: true, lignesRetour: true } },
      client: true,
    },
  });
  if (!vente) return rejet('Vente introuvable dans cette boutique.');
  if (vente.statut === 'ANNULEE') return conflit('Cette vente a été annulée.');

  const dateRetour = new Date(d.dateRetour);
  if (dateRetour.getTime() > Date.now() + MARGE_HORLOGE_MS) {
    return rejet('Date du retour dans le futur : vérifiez l’heure de l’appareil.');
  }
  let validePar = utilisateur.id;
  if (utilisateur.role === Role.VENDEUR) {
    const gerant = await autorisations.retourAutorise(
      d.autorisation,
      commerceId,
      boutiqueId,
      vente.id,
      dateRetour,
    );
    if (!gerant)
      return rejet('Un retour fait par un vendeur doit être validé par le PIN d’un gérant.');
    validePar = gerant;
  }

  // Articles rendus : encore retournables, destination possible, valeur payée.
  const rendus = new Map<string, number>();
  let valeur = 0;
  let sousGarantie = true;
  const lignes: {
    saisie: RetourSaisi['lignes'][number];
    venteLigne: (typeof vente.lignes)[number];
    montant: number;
  }[] = [];
  for (const l of d.lignes) {
    const lv = vente.lignes.find((x) => x.id === l.ligneVenteId);
    if (!lv) return rejet('Un des articles ne fait pas partie de cette vente.');
    const deja = lv.lignesRetour.reduce((t, r) => t + r.quantite, 0) + (rendus.get(lv.id) ?? 0);
    if (l.quantite > quantiteRetournable(lv.quantite, deja)) {
      return conflit(`« ${lv.produit.nom} » : ${deja} sur ${lv.quantite} déjà rendu(s).`);
    }
    rendus.set(lv.id, (rendus.get(lv.id) ?? 0) + l.quantite);
    const erreur = erreurDestination(lv.produit.type, l.destination, l.prixRevente);
    if (erreur) return rejet(`« ${lv.produit.nom} » : ${erreur}`);
    if (lv.article && lv.article.statut !== 'VENDU') {
      return conflit(`IMEI ${lv.article.imei} : n’est plus enregistré comme vendu.`);
    }
    const montant = valeurRetour({ prixUnitaire: Number(lv.prixUnitaire) }, l.quantite, {
      sousTotal: Number(vente.sousTotal),
      remise: Number(vente.remise),
    });
    valeur += montant;
    sousGarantie &&= lv.finGarantie !== null && lv.finGarantie.getTime() >= dateRetour.getTime();
    lignes.push({ saisie: l, venteLigne: lv, montant });
  }

  const commerce = await tx.commerce.findUniqueOrThrow({ where: { id: commerceId } });
  const condition = erreurConditionsRetour({
    dateVente: vente.dateVente,
    dateRetour,
    delaiJours: commerce.delaiRetourJours,
    etat: d.etatAppareil,
    type: d.type,
    sousGarantie,
  });
  if (condition) return rejet(condition);
  if (d.type === 'AVOIR' && !vente.clientId) {
    return rejet('Un avoir est au nom du client : cette vente n’a pas de client.');
  }
  if ((d.type === 'ECHANGE') !== (d.echange !== null)) {
    return rejet(
      d.type === 'ECHANGE'
        ? 'Échange : ajoutez les articles remis au client.'
        : 'Seul un échange comporte de nouveaux articles.',
    );
  }
  const totalEchange = d.echange ? totauxVente(d.echange.lignes, d.echange.remise).total : 0;
  const bilan = bilanRetour(d.type, valeur, totalEchange);
  if (bilan.aRendre > 0) {
    if (!d.remboursement) return rejet('Indiquez comment le client est remboursé.');
    if (moyenAvecReference(d.remboursement.moyen) && !d.remboursement.reference?.trim()) {
      return rejet(
        `${LIBELLES_MOYENS[d.remboursement.moyen]} : saisissez la référence du remboursement.`,
      );
    }
  }

  // Nouvelle vente de l'échange (ses propres contrôles : stock, prix, paiement du reste).
  if (d.echange) {
    const resultat = await enregistrerVente(ctx, d.echange, bilan.reprise);
    if (!resultat.ok) return { ...resultat, motif: `Échange : ${resultat.motif}` };
  }

  await tx.retour.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      venteId: vente.id,
      type: d.type,
      motif: d.motif,
      etatAppareil: d.etatAppareil,
      valeur,
      montantRembourse: bilan.aRendre,
      moyenRemboursement: bilan.aRendre > 0 ? d.remboursement!.moyen : null,
      referenceRemboursement: bilan.aRendre > 0 ? d.remboursement!.reference?.trim() || null : null,
      avoir: bilan.avoir,
      venteEchangeId: d.echange?.id ?? null,
      valideParId: validePar,
      dateRetour,
      appareilId: utilisateur.appareilId,
      creeParId: utilisateur.id,
    },
  });
  const changements: NouveauChangement[] = [];
  for (const { saisie: l, venteLigne: lv, montant } of lignes) {
    await tx.ligneRetour.create({
      data: {
        id: l.id,
        retourId: d.id,
        ligneVenteId: lv.id,
        articleId: lv.articleId,
        quantite: l.quantite,
        destination: l.destination,
        montant,
        prixRevente: l.prixRevente,
      },
    });
    if (lv.article) {
      const article = await tx.article.update({
        where: { id: lv.article.id },
        data: {
          statut: l.destination === 'REBUT' ? 'REBUT' : 'EN_STOCK',
          boutiqueId,
          ...(l.destination === 'OCCASION' ? { prixRevente: l.prixRevente } : {}),
          ...(l.destination === 'REMISE_EN_STOCK' ? { prixRevente: null } : {}),
        },
      });
      changements.push({
        entite: 'article',
        id: article.id,
        boutiqueId,
        donnees: versArticle(article),
      });
    }
    if (l.destination !== 'REBUT') {
      const stock = await tx.stock.upsert({
        where: { produitId_boutiqueId: { produitId: lv.produitId, boutiqueId } },
        create: { produitId: lv.produitId, boutiqueId, quantite: l.quantite },
        update: { quantite: { increment: l.quantite } },
      });
      changements.push({ entite: 'stock', id: stock.id, boutiqueId, donnees: versStock(stock) });
    }
    await tx.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId,
        produitId: lv.produitId,
        articleId: lv.articleId,
        type: 'RETOUR',
        quantite: l.destination === 'REBUT' ? 0 : l.quantite,
        motif: `${LIBELLES_DESTINATIONS[l.destination]} · ${d.motif}`,
        referenceType: 'Retour',
        referenceId: d.id,
        utilisateurId: utilisateur.id,
      },
    });
  }
  if (bilan.avoir > 0 && vente.clientId) {
    const client = await tx.client.update({
      where: { id: vente.clientId },
      data: { soldeAvoir: { increment: bilan.avoir } },
    });
    changements.push({
      entite: 'client',
      id: client.id,
      boutiqueId: null,
      donnees: versClient(client),
    });
  }
  await journal.ecrire(tx, commerceId, [...changements, ...(await changementsRetour(tx, d.id))]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.RETOUR_ENREGISTRE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Retour',
      entiteId: d.id,
      details: {
        vente: vente.numero,
        type: d.type,
        etat: d.etatAppareil,
        motif: d.motif,
        valeur,
        ...bilan,
        validePar,
      },
    },
    tx,
  );
  return OK;
}
