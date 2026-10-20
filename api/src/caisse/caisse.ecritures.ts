import {
  bilanCaisse,
  type ContenuOperation,
  type Controle,
  ecartsCaisse,
  erreurCloture,
  type MouvementsCaisse,
  type MoyenRemboursement,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import { versCaisse, versDepense } from '../sync/serialisation.js';

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Controle => ({ ok: false, statut: 'CONFLIT', motif });

const date = (d: Date) => d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export async function changementCaisse(tx: Tx, caisseId: string): Promise<NouveauChangement> {
  const caisse = await tx.caisse.findUniqueOrThrow({
    where: { id: caisseId },
    include: { utilisateur: { select: { nom: true } } },
  });
  const valideur = caisse.valideParId
    ? await tx.utilisateur.findUnique({ where: { id: caisse.valideParId }, select: { nom: true } })
    : null;
  return {
    entite: 'caisse',
    id: caisse.id,
    boutiqueId: caisse.boutiqueId,
    donnees: versCaisse(caisse, caisse.utilisateur.nom, valideur?.nom ?? null),
  };
}

/**
 * Caisse où rattacher une vente, un retour ou une dépense : la caisse ouverte de
 * l'utilisateur dans cette boutique. Sinon rien n'est rattaché (la vente reste valable).
 */
export async function caisseDeRattachement(
  tx: Tx,
  caisseId: string | null | undefined,
  utilisateur: UtilisateurConnecte,
  boutiqueId: string,
): Promise<string | null> {
  if (!caisseId) return null;
  const caisse = await tx.caisse.findFirst({
    where: {
      id: caisseId,
      commerceId: utilisateur.commerceId,
      boutiqueId,
      utilisateurId: utilisateur.id,
      statut: 'OUVERTE',
    },
  });
  return caisse?.id ?? null;
}

/** Ce qui est passé par une caisse (ventes, remboursements, dépenses). */
export async function mouvementsCaisse(tx: Tx, caisseId: string): Promise<MouvementsCaisse> {
  const caisse = await tx.caisse.findUniqueOrThrow({ where: { id: caisseId } });
  const [ventes, retours, depenses] = await Promise.all([
    tx.vente.findMany({ where: { caisseId }, include: { paiements: true } }),
    tx.retour.findMany({ where: { caisseId } }),
    tx.depense.findMany({ where: { caisseId } }),
  ]);
  return {
    fondInitial: Number(caisse.fondInitial),
    ventes: ventes.map((v) => ({
      statut: v.statut,
      renduMonnaie: Number(v.renduMonnaie),
      paiements: v.paiements.map((p) => ({ moyen: p.moyen, montant: Number(p.montant) })),
    })),
    retours: retours.map((r) => ({
      montantRembourse: Number(r.montantRembourse),
      moyenRemboursement:
        r.moyenRemboursement === 'AVOIR'
          ? null
          : (r.moyenRemboursement as MoyenRemboursement | null),
    })),
    depenses: depenses.map((d) => ({
      montant: Number(d.montant),
      moyen: (d.moyen === 'AVOIR' ? 'ESPECES' : d.moyen) as MoyenRemboursement,
    })),
  };
}

/** Ouverture de la caisse du jour, avec son fond ; une seule caisse ouverte par vendeur et boutique. */
export async function ouvrirCaisse(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'CAISSE_OUVRIR'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  if (await tx.caisse.findUnique({ where: { id: d.id } }))
    return rejet('Identifiant déjà utilisé.');
  const ouverte = await tx.caisse.findFirst({
    where: { commerceId, boutiqueId, utilisateurId: utilisateur.id, statut: 'OUVERTE' },
  });
  if (ouverte) {
    return conflit(
      `Vous avez déjà une caisse ouverte depuis le ${date(ouverte.ouverteLe)} : clôturez-la d’abord.`,
    );
  }
  await tx.caisse.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      utilisateurId: utilisateur.id,
      ouverteLe: new Date(d.ouverteLe),
      fondInitial: d.fondInitial,
      appareilId: utilisateur.appareilId,
    },
  });
  await journal.ecrire(tx, commerceId, [await changementCaisse(tx, d.id)]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.CAISSE_OUVERTE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Caisse',
      entiteId: d.id,
      details: { fondInitial: d.fondInitial },
    },
    tx,
  );
  return OK;
}

/**
 * Clôture par le vendeur (ou la gestion) : le montant attendu de chaque moyen est
 * recalculé par le serveur ; tout écart doit être expliqué.
 */
export async function cloturerCaisse(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'CAISSE_CLOTURER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const caisse = await tx.caisse.findFirst({ where: { id: d.caisseId, commerceId, boutiqueId } });
  if (!caisse) return rejet('Caisse introuvable dans cette boutique.');
  if (caisse.utilisateurId !== utilisateur.id && utilisateur.role === Role.VENDEUR) {
    return rejet('Seul son vendeur, un gérant ou le propriétaire clôture une caisse.');
  }
  if (caisse.statut !== 'OUVERTE') return conflit('Cette caisse est déjà clôturée.');
  const clotureeLe = new Date(d.clotureeLe);
  if (clotureeLe < caisse.ouverteLe) return rejet('Clôture datée avant l’ouverture.');

  const { theorique } = bilanCaisse(await mouvementsCaisse(tx, caisse.id));
  const ecarts = ecartsCaisse(theorique, d.comptage);
  const erreur = erreurCloture(ecarts.parMoyen, d.commentaire);
  if (erreur) {
    return rejet(`${erreur} (écart de ${ecarts.total} selon le serveur)`);
  }
  await tx.caisse.update({
    where: { id: caisse.id },
    data: {
      statut: 'CLOTUREE',
      clotureeLe,
      comptage: d.comptage,
      theorique,
      ecart: ecarts.total,
      commentaire: d.commentaire?.trim() || null,
    },
  });
  await journal.ecrire(tx, commerceId, [await changementCaisse(tx, caisse.id)]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.CAISSE_CLOTUREE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Caisse',
      entiteId: caisse.id,
      details: { theorique, comptage: d.comptage, ecart: ecarts.total },
    },
    tx,
  );
  return OK;
}

/** Validation par le gérant ou le propriétaire, une fois la caisse clôturée. */
export async function validerCaisse(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'CAISSE_VALIDER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const caisse = await tx.caisse.findFirst({ where: { id: d.caisseId, commerceId, boutiqueId } });
  if (!caisse) return rejet('Caisse introuvable dans cette boutique.');
  if (caisse.statut === 'VALIDEE') return OK;
  if (caisse.statut === 'OUVERTE') return conflit('La caisse doit d’abord être clôturée.');
  await tx.caisse.update({
    where: { id: caisse.id },
    data: {
      statut: 'VALIDEE',
      valideParId: utilisateur.id,
      valideLe: new Date(),
      commentaireValidation: d.commentaire?.trim() || null,
    },
  });
  await journal.ecrire(tx, commerceId, [await changementCaisse(tx, caisse.id)]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.CAISSE_VALIDEE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Caisse',
      entiteId: caisse.id,
      details: { ecart: Number(caisse.ecart ?? 0), commentaire: d.commentaire },
    },
    tx,
  );
  return OK;
}

/**
 * Dépense de la boutique. Depuis une caisse : la caisse ouverte de l'auteur ; un
 * vendeur ne paie une dépense que depuis sa caisse.
 */
export async function enregistrerDepense(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'DEPENSE_ENREGISTRER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  if (await tx.depense.findUnique({ where: { id: d.id } }))
    return rejet('Identifiant déjà utilisé.');
  if (!d.caisseId && utilisateur.role === Role.VENDEUR) {
    return rejet('Un vendeur paie une dépense depuis sa caisse.');
  }
  if (d.caisseId) {
    if (!(await caisseDeRattachement(tx, d.caisseId, utilisateur, boutiqueId))) {
      return conflit(
        'Cette caisse n’est plus ouverte : enregistrez la dépense sur la caisse du jour.',
      );
    }
  }
  const depense = await tx.depense.create({
    data: {
      id: d.id,
      commerceId,
      boutiqueId,
      caisseId: d.caisseId,
      categorie: d.categorie,
      libelle: d.libelle,
      montant: d.montant,
      moyen: d.moyen,
      dateDepense: new Date(d.dateDepense),
      appareilId: utilisateur.appareilId,
      creeParId: utilisateur.id,
    },
  });
  await journal.ecrire(tx, commerceId, [
    { entite: 'depense', id: depense.id, boutiqueId, donnees: versDepense(depense) },
  ]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.DEPENSE_ENREGISTREE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Depense',
      entiteId: depense.id,
      details: { categorie: d.categorie, montant: d.montant, caisseId: d.caisseId },
    },
    tx,
  );
  return OK;
}
