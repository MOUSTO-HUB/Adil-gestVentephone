import {
  type ClientSaisi,
  type Controle,
  erreurDroitsClient,
  type FournisseurSaisi,
} from '@gestvente/commun';
import { ACTIONS_AUDIT } from '../audit/audit.service.js';
import type { ContexteCatalogue } from '../catalogue/catalogue.ecritures.js';
import type { NouveauChangement, Tx } from '../sync/journal.service.js';
import { versClient, versFournisseur, versGarant } from '../sync/serialisation.js';

const OK: Controle = { ok: true };
const rejet = (motif: string): Controle => ({ ok: false, statut: 'REJETEE', motif });

/** Reste dû à un fournisseur : total des bons d'achat moins ce qui a été payé. */
export async function detteFournisseur(tx: Tx, fournisseurId: string): Promise<number> {
  const somme = await tx.achat.aggregate({
    where: { fournisseurId, statut: { not: 'ANNULE' } },
    _sum: { montantTotal: true, montantPaye: true },
  });
  return Number((somme._sum.montantTotal ?? 0n) - (somme._sum.montantPaye ?? 0n));
}

/** Dettes de tous les fournisseurs d'un commerce (instantané). */
export async function dettesFournisseurs(tx: Tx, commerceId: string): Promise<Map<string, number>> {
  const lignes = await tx.achat.groupBy({
    by: ['fournisseurId'],
    where: { commerceId, statut: { not: 'ANNULE' } },
    _sum: { montantTotal: true, montantPaye: true },
  });
  return new Map(
    lignes.map((l) => [
      l.fournisseurId,
      Number((l._sum.montantTotal ?? 0n) - (l._sum.montantPaye ?? 0n)),
    ]),
  );
}

/**
 * Client et son garant (un seul). Tout le personnel enregistre des clients ; le
 * plafond de crédit et le classement grossiste suivent `erreurDroitsClient`.
 */
export async function enregistrerClient(
  { tx, utilisateur, journal, audit }: ContexteCatalogue,
  d: ClientSaisi,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existant = await tx.client.findUnique({ where: { id: d.id } });
  if (existant && existant.commerceId !== commerceId) return rejet('Identifiant déjà utilisé.');
  const avant = existant
    ? {
        plafondCredit: existant.plafondCredit === null ? null : Number(existant.plafondCredit),
        type: existant.type,
      }
    : null;
  const droits = erreurDroitsClient(utilisateur.role, avant, d);
  if (droits) return rejet(droits);

  const garants = await tx.garant.findMany({ where: { clientId: d.id } });
  const retires = garants.filter((g) => g.id !== d.garant?.id);
  if (d.garant) {
    const autre = await tx.garant.findUnique({ where: { id: d.garant.id } });
    if (autre && autre.clientId !== d.id) return rejet('Identifiant de garant déjà utilisé.');
  }
  if (
    retires.length &&
    (await tx.credit.count({ where: { garantId: { in: retires.map((g) => g.id) } } }))
  ) {
    return rejet('Ce garant est lié à un crédit : il ne peut pas être retiré.');
  }

  const champs = {
    nom: d.nom,
    telephone: d.telephone,
    type: d.type,
    typePiece: d.typePiece,
    numeroPiece: d.numeroPiece || null,
    adresse: d.adresse || null,
    plafondCredit: d.plafondCredit,
    archive: d.archive,
  };
  const client = await tx.client.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, creeParId: utilisateur.id, ...champs },
    update: champs,
  });

  const changements: NouveauChangement[] = [
    { entite: 'client', id: client.id, boutiqueId: null, donnees: versClient(client) },
  ];
  if (retires.length) {
    await tx.garant.deleteMany({ where: { id: { in: retires.map((g) => g.id) } } });
    changements.push(
      ...retires.map((g) => ({
        entite: 'garant' as const,
        id: g.id,
        boutiqueId: null,
        donnees: null,
      })),
    );
  }
  if (d.garant) {
    const { id, ...garant } = d.garant;
    const champsGarant = {
      ...garant,
      numeroPiece: garant.numeroPiece || null,
      adresse: garant.adresse || null,
      lien: garant.lien || null,
    };
    const ligne = await tx.garant.upsert({
      where: { id },
      create: { id, clientId: client.id, creeParId: utilisateur.id, ...champsGarant },
      update: champsGarant,
    });
    changements.push({
      entite: 'garant',
      id: ligne.id,
      boutiqueId: null,
      donnees: versGarant(ligne),
    });
  }
  await journal.ecrire(tx, commerceId, changements);

  if ((avant?.plafondCredit ?? null) !== d.plafondCredit) {
    await audit.journaliser(
      {
        commerceId,
        action: ACTIONS_AUDIT.PLAFOND_CREDIT_MODIFIE,
        utilisateurId: utilisateur.id,
        appareilId: utilisateur.appareilId,
        entite: 'Client',
        entiteId: client.id,
        details: { nom: client.nom, avant: avant?.plafondCredit ?? null, apres: d.plafondCredit },
      },
      tx,
    );
  }
  return OK;
}

export async function enregistrerFournisseur(
  { tx, utilisateur, journal }: ContexteCatalogue,
  d: FournisseurSaisi,
): Promise<Controle> {
  const { commerceId } = utilisateur;
  const existant = await tx.fournisseur.findUnique({ where: { id: d.id } });
  if (existant && existant.commerceId !== commerceId) return rejet('Identifiant déjà utilisé.');
  const doublon = await tx.fournisseur.findFirst({
    where: { commerceId, nom: { equals: d.nom, mode: 'insensitive' }, id: { not: d.id } },
  });
  if (doublon) return rejet(`Le fournisseur « ${doublon.nom} » existe déjà.`);
  const champs = {
    nom: d.nom,
    telephone: d.telephone,
    adresse: d.adresse || null,
    note: d.note || null,
    archive: d.archive,
  };
  const fournisseur = await tx.fournisseur.upsert({
    where: { id: d.id },
    create: { id: d.id, commerceId, creeParId: utilisateur.id, ...champs },
    update: champs,
  });
  await journal.ecrire(tx, commerceId, [
    {
      entite: 'fournisseur',
      id: fournisseur.id,
      boutiqueId: null,
      donnees: versFournisseur(fournisseur, await detteFournisseur(tx, fournisseur.id)),
    },
  ]);
  return OK;
}
