import { completerImei, type ProduitSync } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { enregistrerOperation } from './sync/operations-locales';
import { formulaireTrocVide, proposerReprise, trocDepuisFormulaire } from './troc';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const VENDEUR = '99999999-9999-4999-8999-999999999999';
const MODELE = '22222222-2222-4222-8222-222222222222';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const telephone = (id: string, nom: string, prixDetail: number, modeleId: string | null) =>
  ({
    id,
    type: 'TELEPHONE',
    categorieId: 'c',
    marqueId: null,
    modeleId,
    nom,
    capacite: '128 Go',
    couleur: null,
    etat: 'NEUF',
    codeBarres: null,
    garantieMois: 3,
    prixAchat: null,
    prixDetail,
    prixGros: prixDetail,
    seuilGros: null,
    archive: false,
    photo: null,
  }) satisfies ProduitSync;

describe('troc sur l’appareil (hors ligne)', () => {
  let base: BaseSql;
  const neuf = uuid();
  const ancien = uuid();
  const articleNeuf = uuid();
  const client = uuid();
  const sansPiece = uuid();

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    await ecrireEntite(base, 'produit', neuf, telephone(neuf, 'iPhone 16', 9_000_000, null));
    await ecrireEntite(base, 'produit', ancien, telephone(ancien, 'iPhone 12', 3_000_000, MODELE));
    await ecrireEntite(base, 'article', articleNeuf, {
      id: articleNeuf,
      produitId: neuf,
      boutiqueId: BOUTIQUE,
      imei: completerImei('35209900000091'),
      imei2: null,
      numeroSerie: null,
      statut: 'EN_STOCK',
      origine: 'ACHAT',
      prixAchat: null,
      prixRevente: null,
    });
    await base.executer(
      "INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES ('s', ?, ?, 1, 0)",
      [neuf, BOUTIQUE],
    );
    const fiche = (id: string, piece: boolean) =>
      ecrireEntite(base, 'client', id, {
        id,
        nom: 'Client',
        telephone: '+224620000000',
        type: 'DETAIL',
        typePiece: piece ? 'CNI' : null,
        numeroPiece: piece ? 'GN-1' : null,
        adresse: null,
        plafondCredit: null,
        soldeAvoir: 0,
        archive: false,
        photoPiece: false,
      });
    await fiche(client, true);
    await fiche(sansPiece, false);
  });

  const formulaire = (imei: string) => ({
    ...formulaireTrocVide(uuid(), uuid()),
    produit: { id: ancien, nom: 'iPhone 12' },
    imei,
    etatBatterie: 'MOYEN' as const,
    valeur: '1 500 000',
    prixRevente: '2200000',
  });

  const vendre = (clientId: string, imei: string) => {
    const resultat = trocDepuisFormulaire(formulaire(imei), 1_500_000);
    if ('erreur' in resultat) throw new Error(resultat.erreur);
    return enregistrerOperation(
      base,
      {
        type: 'VENTE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        utilisateurId: VENDEUR,
        contenu: {
          id: uuid(),
          numero: `MAD-AAAAAA-${String(++compteur).padStart(6, '0')}`,
          dateVente: new Date().toISOString(),
          clientId,
          lignes: [
            {
              id: uuid(),
              produitId: neuf,
              articleId: articleNeuf,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 9_000_000,
            },
          ],
          remise: 0,
          paiements: [{ id: uuid(), moyen: 'ESPECES', montant: 7_500_000, reference: null }],
          autorisationRemise: null,
          troc: resultat.troc,
        },
      },
      uuid,
    );
  };

  it('valeur proposée : grille du modèle, sinon estimation sur le prix du neuf', async () => {
    expect(await proposerReprise(base, BOUTIQUE, ancien, 'BON')).toEqual({
      valeur: 1_500_000,
      source: 'ESTIMATION',
    });
    await ecrireEntite(base, 'grilleReprise', 'g', {
      id: 'g',
      modeleId: MODELE,
      capacite: '128 Go',
      etat: 'BON',
      valeur: 1_700_000,
    });
    expect(await proposerReprise(base, BOUTIQUE, ancien, 'BON')).toEqual({
      valeur: 1_700_000,
      source: 'GRILLE',
    });
  });

  it('la vente déduit la reprise ; l’appareil repris entre en stock', async () => {
    const imei = completerImei('35209900000092');
    await vendre(client, imei);
    const vente = await base.premier<{ total: number; reprise: number }>(
      'SELECT total, reprise FROM vente',
    );
    expect(vente).toEqual({ total: 7_500_000, reprise: 1_500_000 });
    expect(
      await base.premier(
        'SELECT statut, origine, prixAchat, prixRevente FROM article WHERE imei = ?',
        [imei],
      ),
    ).toEqual({
      statut: 'EN_STOCK',
      origine: 'TROC',
      prixAchat: 1_500_000,
      prixRevente: 2_200_000,
    });
    expect(
      await base.premier<{ quantite: number }>('SELECT quantite FROM stock WHERE produitId = ?', [
        ancien,
      ]),
    ).toEqual({ quantite: 1 });
    expect(await base.premier('SELECT etatGlobal, photos FROM troc')).toEqual({
      etatGlobal: 'BON',
      photos: 0,
    });
  });

  it('refusé sans pièce d’identité ou pour un IMEI signalé, sans rien écrire', async () => {
    await expect(vendre(sansPiece, completerImei('35209900000093'))).rejects.toThrow(/pièce/);
    const vole = completerImei('35209900000094');
    await ecrireEntite(base, 'imeiSignale', 'x', {
      id: 'x',
      imei: vole,
      motif: 'VOLE',
      note: null,
      actif: true,
    });
    await expect(vendre(client, vole)).rejects.toThrow(/volé/);
    expect(await base.premier('SELECT COUNT(*) AS n FROM vente')).toEqual({ n: 0 });
    expect(
      await base.premier<{ statut: string }>('SELECT statut FROM article WHERE id = ?', [
        articleNeuf,
      ]),
    ).toEqual({ statut: 'EN_STOCK' });
  });

  it('formulaire incomplet : le motif est donné avant l’encaissement', () => {
    const vide = formulaireTrocVide(uuid(), uuid());
    expect(trocDepuisFormulaire(vide, 0)).toEqual({ erreur: expect.stringMatching(/modèle/) });
    expect(trocDepuisFormulaire({ ...formulaire('1'), prixRevente: '' }, 1_000_000)).toEqual({
      erreur: expect.stringMatching(/prix de revente/),
    });
  });
});
