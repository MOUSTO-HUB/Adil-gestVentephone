import {
  type CreditSync,
  type DocumentCredit,
  type EcheanceSync,
  type EncaissementSync,
  type RecuEncaissement,
  situationCredit,
  type StatutAfficheCredit,
} from '@gestvente/commun';
import type { BaseSql } from './base/sql';
import { FUSEAU_PAR_DEFAUT } from './documents';

export interface LigneCredit extends CreditSync {
  client: string;
  telephone: string;
  situation: ReturnType<typeof situationCredit>;
}

export type FiltreCredits = 'EN_COURS' | 'EN_RETARD' | 'SOLDE' | 'TOUS';

/** Crédits de la boutique avec leur situation du jour, du plus en retard au plus récent. */
export async function listeCredits(
  base: BaseSql,
  boutiqueId: string,
  aujourdhui: string,
  filtre: FiltreCredits,
): Promise<LigneCredit[]> {
  const credits = await base.tous<CreditSync & { client: string; telephone: string }>(
    `SELECT cr.*, c.nom AS client, c.telephone FROM credit cr
       JOIN client c ON c.id = cr.clientId
      WHERE cr.boutiqueId = ? ${filtre === 'SOLDE' ? "AND cr.statut = 'SOLDE'" : filtre === 'TOUS' ? '' : "AND cr.statut = 'EN_COURS'"}
      ORDER BY cr.creeLe DESC LIMIT 500`,
    [boutiqueId],
  );
  const echeances = await base.tous<EcheanceSync>(
    `SELECT e.* FROM echeance e JOIN credit cr ON cr.id = e.creditId WHERE cr.boutiqueId = ?`,
    [boutiqueId],
  );
  return credits
    .map((c) => ({
      ...c,
      situation: situationCredit(
        c.statut,
        echeances.filter((e) => e.creditId === c.id),
        aujourdhui,
      ),
    }))
    .filter((c) => filtre !== 'EN_RETARD' || c.situation.statut === 'EN_RETARD')
    .sort((a, b) => b.situation.joursRetard - a.situation.joursRetard);
}

/** Totaux du tableau des crédits : dû, échu, nombre en retard. */
export function totauxCredits(credits: LigneCredit[]) {
  const enCours = credits.filter((c) => c.statut === 'EN_COURS');
  return {
    du: enCours.reduce((t, c) => t + c.situation.restant, 0),
    echu: enCours.reduce((t, c) => t + c.situation.montantEchu, 0),
    enRetard: enCours.filter((c) => c.situation.statut === 'EN_RETARD').length,
  };
}

export interface DetailCredit {
  credit: CreditSync;
  client: {
    id: string;
    nom: string;
    telephone: string;
    typePiece: string | null;
    numeroPiece: string | null;
    adresse: string | null;
  };
  garant: {
    nom: string;
    telephone: string;
    typePiece: string | null;
    numeroPiece: string | null;
    adresse: string | null;
    lien: string | null;
  } | null;
  echeances: EcheanceSync[];
  encaissements: (EncaissementSync & { auteur: string | null })[];
  statut: StatutAfficheCredit;
}

export async function detailCredit(
  base: BaseSql,
  creditId: string,
  aujourdhui: string,
): Promise<(DetailCredit & { situation: ReturnType<typeof situationCredit> }) | null> {
  const credit = await base.premier<CreditSync>('SELECT * FROM credit WHERE id = ?', [creditId]);
  if (!credit) return null;
  const client = await base.premier<DetailCredit['client']>(
    'SELECT id, nom, telephone, typePiece, numeroPiece, adresse FROM client WHERE id = ?',
    [credit.clientId],
  );
  const garant = credit.garantId
    ? await base.premier<NonNullable<DetailCredit['garant']>>(
        'SELECT nom, telephone, typePiece, numeroPiece, adresse, lien FROM garant WHERE id = ?',
        [credit.garantId],
      )
    : null;
  const echeances = await base.tous<EcheanceSync>(
    'SELECT * FROM echeance WHERE creditId = ? ORDER BY numero',
    [creditId],
  );
  const encaissements = await base.tous<EncaissementSync & { auteur: string | null }>(
    `SELECT e.*, (SELECT vendeur FROM caisse WHERE id = e.caisseId) AS auteur
       FROM encaissement e WHERE e.creditId = ? ORDER BY e.creeLe DESC`,
    [creditId],
  );
  const situation = situationCredit(credit.statut, echeances, aujourdhui);
  return {
    credit,
    client: client ?? {
      id: credit.clientId,
      nom: 'Client',
      telephone: '',
      typePiece: null,
      numeroPiece: null,
      adresse: null,
    },
    garant,
    echeances,
    encaissements,
    statut: situation.statut,
    situation,
  };
}

const piece = (p: { typePiece: string | null; numeroPiece: string | null }) =>
  p.typePiece && p.numeroPiece ? `${p.typePiece} ${p.numeroPiece}` : null;

interface Entete {
  commerce: string;
  boutique: { nom: string; adresse: string | null; telephone?: string | null };
  monnaie: string;
  fuseau?: string;
}

/** Contrat imprimable, d'après la base de l'appareil (même hors ligne). */
export async function documentContrat(
  base: BaseSql,
  d: DetailCredit,
  entete: Entete,
  vendeur: string,
): Promise<DocumentCredit> {
  const lignes = await base.tous<DocumentCredit['lignes'][number]>(
    `SELECT p.nom AS designation, a.imei, l.quantite, l.total
       FROM ligneVente l JOIN produit p ON p.id = l.produitId LEFT JOIN article a ON a.id = l.articleId
      WHERE l.venteId = ? ORDER BY p.type DESC, p.nom`,
    [d.credit.venteId],
  );
  return {
    commerce: entete.commerce,
    boutique: {
      nom: entete.boutique.nom,
      adresse: entete.boutique.adresse,
      telephone: entete.boutique.telephone ?? null,
    },
    numeroVente: d.credit.numeroVente,
    dateVente: d.credit.creeLe,
    vendeur,
    client: {
      nom: d.client.nom,
      telephone: d.client.telephone,
      piece: piece(d.client),
      adresse: d.client.adresse,
    },
    garant: d.garant
      ? {
          nom: d.garant.nom,
          telephone: d.garant.telephone,
          piece: piece(d.garant),
          adresse: d.garant.adresse,
          lien: d.garant.lien,
        }
      : null,
    lignes,
    total: d.credit.montantTotal,
    apport: d.credit.apport,
    montantFinance: d.credit.montantFinance,
    frequence: d.credit.frequence,
    echeances: d.echeances.map((e) => ({
      numero: e.numero,
      date: e.dateEcheance,
      montant: e.montant,
    })),
    monnaie: entete.monnaie,
    fuseau: entete.fuseau ?? FUSEAU_PAR_DEFAUT,
  };
}

/** Reçu d'un encaissement, avec le solde restant après lui. */
export function recuEncaissement(
  d: DetailCredit & { situation: ReturnType<typeof situationCredit> },
  encaissementId: string,
  entete: Entete,
  encaissePar: string,
): RecuEncaissement | null {
  const e = d.encaissements.find((x) => x.id === encaissementId);
  if (!e) return null;
  // Reste dû juste après cet encaissement : celui d'aujourd'hui + les versements suivants.
  const suivants = d.encaissements
    .filter((x) => x.creeLe > e.creeLe)
    .reduce((t, x) => t + x.montant, 0);
  return {
    commerce: entete.commerce,
    boutique: {
      nom: entete.boutique.nom,
      adresse: entete.boutique.adresse,
      telephone: entete.boutique.telephone ?? null,
    },
    numeroVente: d.credit.numeroVente,
    client: d.client.nom,
    date: e.creeLe,
    montant: e.montant,
    moyen: e.moyen,
    reference: e.reference,
    restant: d.situation.restant + suivants,
    prochaine: suivants === 0 && d.situation.prochaine ? d.situation.prochaine : null,
    encaissePar: e.auteur ?? encaissePar,
    monnaie: entete.monnaie,
    fuseau: entete.fuseau ?? FUSEAU_PAR_DEFAUT,
  };
}
