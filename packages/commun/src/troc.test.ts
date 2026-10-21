import { describe, expect, it } from 'vitest';
import { completerImei } from './imei.js';
import {
  erreurClientTroc,
  erreurReprise,
  etatGlobal,
  type LigneGrille,
  plafondReprise,
  schemaTroc,
  valeurProposee,
} from './troc.js';
import { schemaVente } from './ventes.js';

const MODELE = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';

describe('état global de l’appareil repris', () => {
  it('se déduit des composants et du fonctionnement', () => {
    const bon = { ecran: 'BON', batterie: 'BON', boitier: 'BON', fonctionne: true } as const;
    expect(etatGlobal(bon)).toBe('EXCELLENT');
    expect(etatGlobal({ ...bon, boitier: 'MOYEN' })).toBe('BON');
    expect(etatGlobal({ ...bon, boitier: 'MOYEN', batterie: 'MOYEN' })).toBe('MOYEN');
    expect(etatGlobal({ ...bon, ecran: 'MAUVAIS' })).toBe('MAUVAIS');
    expect(etatGlobal({ ...bon, fonctionne: false })).toBe('MAUVAIS');
  });
});

describe('valeur proposée', () => {
  const grille: LigneGrille[] = [
    { modeleId: MODELE, capacite: '128 Go', etat: 'BON', valeur: 2_000_000 },
    { modeleId: MODELE, capacite: null, etat: 'BON', valeur: 1_800_000 },
    { modeleId: MODELE, capacite: null, etat: 'MOYEN', valeur: 1_200_000 },
  ];
  const iphone = (capacite: string | null) => ({ modeleId: MODELE, capacite, prixNeuf: 5_000_000 });

  it('prend la ligne de la grille pour la capacité, sinon celle du modèle', () => {
    expect(valeurProposee(grille, iphone('128 go'), 'BON')).toEqual({
      valeur: 2_000_000,
      source: 'GRILLE',
    });
    expect(valeurProposee(grille, iphone('256 Go'), 'BON').valeur).toBe(1_800_000);
    expect(valeurProposee(grille, iphone(null), 'MOYEN').valeur).toBe(1_200_000);
  });

  it('sans grille : part du prix du neuf selon l’état, arrondie à 5 000 en dessous', () => {
    expect(valeurProposee(grille, iphone('128 Go'), 'EXCELLENT')).toEqual({
      valeur: 3_000_000,
      source: 'ESTIMATION',
    });
    expect(
      valeurProposee([], { modeleId: AUTRE, capacite: null, prixNeuf: 1_234_000 }, 'MOYEN').valeur,
    ).toBe(430_000);
  });
});

describe('ajustement de la reprise', () => {
  it('le vendeur monte de 10 % au plus ; le gérant et le propriétaire sans limite', () => {
    expect(plafondReprise(1_000_000, 'VENDEUR', 10)).toBe(1_100_000);
    expect(plafondReprise(1_000_000, 'GERANT', 10)).toBe(Number.POSITIVE_INFINITY);
    expect(plafondReprise(1_000_000, 'PROPRIETAIRE', 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it('au-delà, la validation d’un gérant est exigée et bornée', () => {
    expect(erreurReprise(900_000, 1_100_000, null)).toBeNull();
    expect(erreurReprise(1_200_000, 1_100_000, null)).toMatch(/gérant/);
    expect(erreurReprise(1_200_000, 1_100_000, 1_250_000)).toBeNull();
    expect(erreurReprise(1_300_000, 1_100_000, 1_250_000)).toMatch(/validée/);
  });
});

describe('saisie du troc', () => {
  const troc = {
    id: '33333333-3333-4333-8333-333333333333',
    articleId: '44444444-4444-4444-8444-444444444444',
    produitId: '55555555-5555-4555-8555-555555555555',
    imei: completerImei('35209900000077'),
    etatEcran: 'BON',
    etatBatterie: 'MOYEN',
    etatBoitier: 'BON',
    fonctionne: true,
    note: '',
    valeurProposee: 1_000_000,
    valeurRetenue: 1_000_000,
    destination: 'A_REVENDRE',
    prixRevente: 1_400_000,
    autorisation: null,
  };

  it('exige un IMEI valide et un prix de revente pour la revente', () => {
    expect(schemaTroc.safeParse(troc).success).toBe(true);
    expect(schemaTroc.safeParse({ ...troc, imei: '123' }).success).toBe(false);
    expect(schemaTroc.safeParse({ ...troc, prixRevente: null }).success).toBe(false);
    expect(
      schemaTroc.safeParse({ ...troc, destination: 'A_REPARER', prixRevente: null }).success,
    ).toBe(true);
  });

  it('se joint à la vente, facultatif', () => {
    const vente = {
      id: '66666666-6666-4666-8666-666666666666',
      numero: 'MAD-ABC123-000001',
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          produitId: troc.produitId,
          articleId: troc.articleId,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 5_000_000,
        },
      ],
      remise: 0,
      paiements: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          moyen: 'ESPECES',
          montant: 4_000_000,
          reference: null,
        },
      ],
      autorisationRemise: null,
    };
    expect(schemaVente.safeParse(vente).success).toBe(true);
    expect(schemaVente.safeParse({ ...vente, troc }).success).toBe(true);
  });

  it('fiche client et pièce d’identité obligatoires', () => {
    expect(erreurClientTroc(null)).toMatch(/fiche/);
    expect(erreurClientTroc({ typePiece: 'CNI', numeroPiece: ' ' })).toMatch(/pièce/);
    expect(erreurClientTroc({ typePiece: 'CNI', numeroPiece: 'GN-123' })).toBeNull();
  });
});
