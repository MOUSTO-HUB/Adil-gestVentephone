import {
  type ContenuOperation,
  type Controle,
  type CreditSaisi,
  echeancier,
  erreurConditionsCredit,
  erreurFicheCredit,
  erreurPlafondCredit,
  repartirEncaissement,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import { caisseDeRattachement } from '../caisse/caisse.ecritures.js';
import type { Client } from '../generated/prisma/client.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import type { ContexteOperation } from '../sync/operations/gestionnaire.js';
import { versCredit, versEcheance, versEncaissement } from '../sync/serialisation.js';

type Refus = Extract<Controle, { ok: false }>;
const OK: Controle = { ok: true };
const rejet = (motif: string): Refus => ({ ok: false, statut: 'REJETEE', motif });
const conflit = (motif: string): Refus => ({ ok: false, statut: 'CONFLIT', motif });

/** Jour AAAA-MM-JJ ↔ date enregistrée (minuit UTC). */
export const versDateJour = (jour: string) => new Date(`${jour}T00:00:00.000Z`);

/** Changements d'un crédit pour les appareils : le crédit et ses tranches. */
export async function changementsCredit(tx: Tx, creditId: string): Promise<NouveauChangement[]> {
  const credit = await tx.credit.findUniqueOrThrow({
    where: { id: creditId },
    include: { echeances: true, vente: { select: { numero: true } } },
  });
  const boutiqueId = credit.boutiqueId;
  return [
    { entite: 'credit', id: credit.id, boutiqueId, donnees: versCredit(credit) },
    ...credit.echeances.map((e) => ({
      entite: 'echeance' as const,
      id: e.id,
      boutiqueId,
      donnees: versEcheance(e),
    })),
  ];
}

/**
 * Contrôles du crédit joint à une vente, avant toute écriture : fiche client complète,
 * garant du client, conditions (apport, tranches), plafond (encours de tout le
 * commerce + nouveau crédit, sinon conflit à revoir par le gérant).
 */
export async function controlerCredit(
  { tx, utilisateur }: ContexteOperation,
  c: CreditSaisi,
  client: Client | null,
  total: number,
): Promise<Refus | null> {
  const { commerceId } = utilisateur;
  const fiche = erreurFicheCredit(client);
  if (fiche || !client) return rejet(fiche ?? 'Client inconnu.');
  const conditions = erreurConditionsCredit(total, c.apport, c.nombreTranches);
  if (conditions) return rejet(conditions);
  if (await tx.credit.findUnique({ where: { id: c.id } })) return rejet('Crédit déjà enregistré.');
  if (await tx.echeance.count({ where: { id: { in: c.echeanceIds } } })) {
    return rejet('Identifiant de tranche déjà utilisé.');
  }
  if (
    c.garantId &&
    !(await tx.garant.findFirst({ where: { id: c.garantId, clientId: client.id } }))
  ) {
    return rejet('Ce garant n’est pas celui du client.');
  }
  const encours = await tx.credit.aggregate({
    where: { commerceId, clientId: client.id, statut: 'EN_COURS' },
    _sum: { montantRestant: true },
  });
  const plafond = erreurPlafondCredit(
    client.plafondCredit === null ? null : Number(client.plafondCredit),
    Number(encours._sum.montantRestant ?? 0n),
    total - c.apport,
  );
  if (plafond) return client.plafondCredit === null ? rejet(plafond) : conflit(plafond);
  return null;
}

/** Crédit et tranches, écrits après la vente. */
export async function ecrireCredit(
  { tx, utilisateur, operation, audit }: ContexteOperation,
  c: CreditSaisi,
  venteId: string,
  clientId: string,
  total: number,
): Promise<NouveauChangement[]> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  const finance = total - c.apport;
  await tx.credit.create({
    data: {
      id: c.id,
      commerceId,
      boutiqueId,
      venteId,
      clientId,
      garantId: c.garantId,
      montantTotal: total,
      apport: c.apport,
      montantFinance: finance,
      montantRestant: finance,
      nombreTranches: c.nombreTranches,
      frequence: c.frequence,
      premiereEcheance: versDateJour(c.premiereEcheance),
      creeParId: utilisateur.id,
    },
  });
  const tranches = echeancier(finance, c.nombreTranches, c.frequence, c.premiereEcheance);
  await tx.echeance.createMany({
    data: tranches.map((t, i) => ({
      id: c.echeanceIds[i],
      creditId: c.id,
      numero: t.numero,
      dateEcheance: versDateJour(t.date),
      montant: t.montant,
    })),
  });
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.CREDIT_ACCORDE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Credit',
      entiteId: c.id,
      details: {
        venteId,
        total,
        apport: c.apport,
        finance,
        tranches: c.nombreTranches,
        frequence: c.frequence,
      },
    },
    tx,
  );
  return changementsCredit(tx, c.id);
}

/**
 * Encaissement d'une tranche (totale ou partielle), réparti de la plus ancienne à la
 * plus récente ; rattaché à la caisse ouverte de son auteur. Le crédit est soldé quand
 * plus rien n'est dû. Au-delà du reste dû (versement déjà reçu ailleurs) : conflit.
 */
export async function encaisserTranche(
  { tx, utilisateur, operation, journal, audit }: ContexteOperation,
  d: ContenuOperation<'CREDIT_ENCAISSER'>,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const boutiqueId = operation.boutiqueId;
  if (await tx.encaissement.findUnique({ where: { id: d.id } })) {
    return rejet('Encaissement déjà enregistré.');
  }
  const credit = await tx.credit.findFirst({
    where: { id: d.creditId, commerceId, boutiqueId },
    include: { echeances: true },
  });
  if (!credit) return rejet('Crédit introuvable dans cette boutique.');
  if (credit.statut !== 'EN_COURS') {
    return conflit(
      credit.statut === 'SOLDE' ? 'Ce crédit est déjà soldé.' : 'Ce crédit est annulé.',
    );
  }
  if (d.moyen !== 'ESPECES' && !d.reference?.trim()) {
    return rejet('Saisissez la référence de la transaction.');
  }
  const echeances = credit.echeances.map((e) => ({
    id: e.id,
    numero: e.numero,
    dateEcheance: e.dateEcheance.toISOString().slice(0, 10),
    montant: Number(e.montant),
    montantPaye: Number(e.montantPaye),
    penalite: Number(e.penalite),
  }));
  const repartition = repartirEncaissement(echeances, d.montant);
  if (!repartition.ok) return conflit(repartition.motif);

  const date = new Date(d.dateEncaissement);
  const caisseId = await caisseDeRattachement(tx, d.caisseId, utilisateur, boutiqueId);
  const encaissement = await tx.encaissement.create({
    data: {
      id: d.id,
      commerceId,
      creditId: credit.id,
      caisseId,
      moyen: d.moyen,
      montant: d.montant,
      reference: d.reference?.trim() || null,
      appareilId: utilisateur.appareilId,
      creeLe: date,
      creeParId: utilisateur.id,
    },
  });
  for (const part of repartition.parts) {
    const e = echeances.find((x) => x.numero === part.numero)!;
    const paye = e.montantPaye + part.montant;
    await tx.echeance.update({
      where: { id: e.id },
      data: { montantPaye: paye, soldeeLe: paye >= e.montant + e.penalite ? date : null },
    });
  }
  const restant = Number(credit.montantRestant) - d.montant;
  await tx.credit.update({
    where: { id: credit.id },
    data: {
      montantRestant: restant,
      ...(restant <= 0 ? { statut: 'SOLDE', soldeLe: date } : {}),
    },
  });
  await journal.ecrire(tx, commerceId, [
    ...(await changementsCredit(tx, credit.id)),
    {
      entite: 'encaissement',
      id: encaissement.id,
      boutiqueId,
      donnees: versEncaissement(encaissement),
    },
  ]);
  await audit.journaliser(
    {
      commerceId,
      boutiqueId,
      action: ACTIONS_AUDIT.ENCAISSEMENT_CREDIT,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Credit',
      entiteId: credit.id,
      details: { montant: d.montant, moyen: d.moyen, restant, tranches: repartition.parts },
    },
    tx,
  );
  return OK;
}
