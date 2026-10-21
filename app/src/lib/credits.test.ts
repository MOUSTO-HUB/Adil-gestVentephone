import { completerImei } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { mouvementsCaisse } from './caisse-session';
import { creditDepuisFormulaire, formulaireCreditVide, jourSaisi } from './credit-saisie';
import { detailCredit, listeCredits, recuEncaissement, totauxCredits } from './credits';
import { enregistrerOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const VENDEUR = '99999999-9999-4999-8999-999999999999';
const AUJOURDHUI = '2026-10-21';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('crédit sur l’appareil (hors ligne)', () => {
  let base: BaseSql;
  const telephone = uuid();
  const article = uuid();
  const client = uuid();
  const caisse = uuid();

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    await ecrireEntite(base, 'produit', telephone, {
      id: telephone,
      type: 'TELEPHONE',
      categorieId: 'c',
      marqueId: null,
      modeleId: null,
      nom: 'Samsung A55',
      capacite: null,
      couleur: null,
      etat: 'NEUF',
      codeBarres: null,
      garantieMois: 3,
      prixAchat: null,
      prixDetail: 3_000_000,
      prixGros: 3_000_000,
      seuilGros: null,
      archive: false,
      photo: null,
    });
    await ecrireEntite(base, 'article', article, {
      id: article,
      produitId: telephone,
      boutiqueId: BOUTIQUE,
      imei: completerImei('35209900000111'),
      imei2: null,
      numeroSerie: null,
      statut: 'EN_STOCK',
      origine: 'ACHAT',
      prixAchat: null,
      prixRevente: null,
    });
    await ecrireEntite(base, 'client', client, {
      id: client,
      nom: 'Binta Diallo',
      telephone: '+224620112233',
      type: 'DETAIL',
      typePiece: 'CNI',
      numeroPiece: 'GN-1',
      adresse: 'Madina',
      plafondCredit: 5_000_000,
      soldeAvoir: 0,
      archive: false,
      photoPiece: false,
    });
    await base.executer(
      `INSERT INTO caisse (id, boutiqueId, utilisateurId, vendeur, statut, ouverteLe, fondInitial)
       VALUES (?, ?, ?, 'Vendeur', 'OUVERTE', ?, 100000)`,
      [caisse, BOUTIQUE, VENDEUR, new Date().toISOString()],
    );
  });

  const vendreACredit = async () => {
    const formulaire = { ...formulaireCreditVide(AUJOURDHUI), apport: '500 000' };
    const resultat = creditDepuisFormulaire(formulaire, 3_000_000, AUJOURDHUI, null, uuid);
    if ('erreur' in resultat) throw new Error(resultat.erreur);
    await enregistrerOperation(
      base,
      {
        type: 'VENTE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: VENDEUR,
        contenu: {
          id: uuid(),
          numero: 'MAD-AAAAAA-000001',
          dateVente: new Date().toISOString(),
          clientId: client,
          lignes: [
            {
              id: uuid(),
              produitId: telephone,
              articleId: article,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 3_000_000,
            },
          ],
          remise: 0,
          paiements: [{ id: uuid(), moyen: 'ESPECES', montant: 500_000, reference: null }],
          autorisationRemise: null,
          caisseId: caisse,
          credit: resultat.credit,
        },
      },
      uuid,
    );
    return resultat.credit.id;
  };

  it('saisie : dates JJ/MM/AAAA, première échéance par défaut dans un mois', () => {
    expect(jourSaisi('5/1/2027')).toBe('2027-01-05');
    expect(jourSaisi('31/02/2027')).toBeNull();
    expect(formulaireCreditVide(AUJOURDHUI).premiere).toBe('21/11/2026');
  });

  it('vente à crédit : apport en caisse, échéancier, tableau des crédits', async () => {
    const creditId = await vendreACredit();
    const vente = await base.premier('SELECT mode, total, montantPaye FROM vente');
    expect(vente).toEqual({ mode: 'CREDIT', total: 3_000_000, montantPaye: 500_000 });
    const detail = await detailCredit(base, creditId, AUJOURDHUI);
    expect(detail?.echeances.map((e) => [e.dateEcheance, e.montant])).toEqual([
      ['2026-11-21', 833_333],
      ['2026-12-21', 833_333],
      ['2027-01-21', 833_334],
    ]);
    const liste = await listeCredits(base, BOUTIQUE, '2026-12-01', 'EN_RETARD');
    expect(liste).toHaveLength(1);
    expect(totauxCredits(liste)).toEqual({ du: 2_500_000, echu: 833_333, enRetard: 1 });
  });

  it('tranche partielle hors ligne : solde, reçu et caisse', async () => {
    const creditId = await vendreACredit();
    const encaissement = uuid();
    await enregistrerOperation(
      base,
      {
        type: 'CREDIT_ENCAISSER',
        boutiqueId: BOUTIQUE,
        utilisateurId: VENDEUR,
        contenu: {
          id: encaissement,
          creditId,
          dateEncaissement: new Date().toISOString(),
          moyen: 'ESPECES',
          montant: 300_000,
          reference: null,
          caisseId: caisse,
        },
      },
      uuid,
    );
    const detail = (await detailCredit(base, creditId, AUJOURDHUI))!;
    expect(detail.situation.restant).toBe(2_200_000);
    expect(detail.echeances[0].montantPaye).toBe(300_000);
    const recu = recuEncaissement(
      detail,
      encaissement,
      { commerce: 'Adil Phone', boutique: { nom: 'Madina', adresse: null }, monnaie: 'GNF' },
      'Vendeur',
    );
    expect(recu).toMatchObject({
      montant: 300_000,
      restant: 2_200_000,
      prochaine: { date: '2026-11-21', reste: 533_333 },
    });
    const mouvements = await mouvementsCaisse(base, caisse);
    expect(mouvements.encaissements).toEqual([{ montant: 300_000, moyen: 'ESPECES' }]);
    await expect(
      enregistrerOperation(
        base,
        {
          type: 'CREDIT_ENCAISSER',
          boutiqueId: BOUTIQUE,
          contenu: {
            id: uuid(),
            creditId,
            dateEncaissement: new Date().toISOString(),
            moyen: 'ESPECES',
            montant: 2_200_001,
            reference: null,
            caisseId: caisse,
          },
        },
        uuid,
      ),
    ).rejects.toThrow(/ne doit plus que 2200000/);
  });
});
