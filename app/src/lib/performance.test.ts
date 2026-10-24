import { completerImei } from '@gestvente/commun';
import { beforeAll, describe, expect, it } from 'vitest';
import { ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { rechercherProduits, trouverParCode } from './catalogue';
import { prochainNumeroFacture } from './panier';
import { enregistrerOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const APPAREIL = '3f2a9c1e-0000-4000-8000-000000000000';
const VENDEUR = '99999999-9999-4999-8999-999999999999';
const uuid = (prefixe: string, n: number) =>
  `${prefixe}-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * Exigences 4.4 sur le volume du cahier des charges : 10 000 produits et 20 000 IMEI
 * dans la boutique, 5 000 ventes passées. Seuils mesurés ici (machine de
 * développement) avec une marge pour un téléphone d'entrée de gamme, 5 à 10 fois
 * plus lent : recherche < 100 ms, vente < 300 ms.
 */
describe('performance sur 10 000 produits et 20 000 IMEI', () => {
  let base: BaseSql;
  let imeiCherche: string;

  beforeAll(async () => {
    base = baseEnMemoire();
    await migrer(base);
    await base.transaction(async (tx) => {
      for (let i = 0; i < 10_000; i++) {
        const id = uuid('00000000', i);
        await ecrireEntite(tx, 'produit', id, {
          id,
          type: i % 2 ? 'ACCESSOIRE' : 'TELEPHONE',
          categorieId: 'c',
          marqueId: null,
          modeleId: null,
          nom: `${i % 2 ? 'Coque' : 'Téléphone'} modèle ${i}`,
          capacite: i % 2 ? null : '128 Go',
          couleur: null,
          etat: 'NEUF',
          codeBarres: `CB${i}`,
          garantieMois: 3,
          prixAchat: null,
          prixDetail: 100_000,
          prixGros: 90_000,
          seuilGros: null,
          archive: false,
          photo: null,
        });
        await tx.executer(
          'INSERT INTO stock (id, produitId, boutiqueId, quantite, seuilMinimum) VALUES (?, ?, ?, 50, 0)',
          [uuid('22222222', i), id, BOUTIQUE],
        );
      }
      for (let j = 0; j < 20_000; j++) {
        const imei = completerImei(`35${String(j).padStart(12, '0')}`);
        if (j === 12_345) imeiCherche = imei;
        await tx.executer(
          "INSERT INTO article (id, produitId, boutiqueId, imei, statut, origine) VALUES (?, ?, ?, ?, 'EN_STOCK', 'ACHAT')",
          [uuid('33333333', j), uuid('00000000', (j % 5_000) * 2), BOUTIQUE, imei],
        );
      }
      for (let k = 0; k < 5_000; k++) {
        await tx.executer(
          `INSERT INTO vente (id, boutiqueId, numero, vendeurId, mode, statut, sousTotal, remise, total,
             montantPaye, renduMonnaie, dateVente) VALUES (?, ?, ?, ?, 'COMPTANT', 'VALIDEE', 1, 0, 1, 1, 0, ?)`,
          [
            uuid('44444444', k),
            BOUTIQUE,
            `MAD-3F2A9C-${String(k + 1).padStart(6, '0')}`,
            VENDEUR,
            new Date().toISOString(),
          ],
        );
      }
    });
  }, 120_000);

  const chrono = async <T>(travail: () => Promise<T>) => {
    const debut = performance.now();
    const resultat = await travail();
    return { resultat, ms: performance.now() - debut };
  };

  it('recherche par nom, code-barres et IMEI en bien moins d’une seconde', async () => {
    const nom = await chrono(() => rechercherProduits(base, BOUTIQUE, 'modèle 4242'));
    const imei = await chrono(() => trouverParCode(base, BOUTIQUE, imeiCherche));
    const code = await chrono(() => trouverParCode(base, BOUTIQUE, 'CB9999'));
    expect(nom.resultat.length).toBeGreaterThan(0);
    expect(imei.resultat?.articleId).toBe(uuid('33333333', 12_345));
    expect(code.resultat).not.toBeNull();
    for (const { ms } of [nom, imei, code]) expect(ms).toBeLessThan(100);
  });

  it('vente (numéro, contrôles, stock, lignes) en bien moins de 2 secondes', async () => {
    const { ms } = await chrono(async () => {
      const numero = await prochainNumeroFacture(base, 'MAD', APPAREIL);
      await enregistrerOperation(
        base,
        {
          type: 'VENTE_ENREGISTRER',
          boutiqueId: BOUTIQUE,
          utilisateurId: VENDEUR,
          contenu: {
            id: uuid('55555555', 1),
            numero,
            dateVente: new Date().toISOString(),
            clientId: null,
            lignes: [
              {
                id: uuid('66666666', 1),
                produitId: uuid('00000000', 2 * 2_345),
                articleId: uuid('33333333', 2_345),
                quantite: 1,
                tarif: 'DETAIL',
                prixUnitaire: 100_000,
              },
              {
                id: uuid('66666666', 2),
                produitId: uuid('00000000', 1),
                articleId: null,
                quantite: 2,
                tarif: 'DETAIL',
                prixUnitaire: 100_000,
              },
            ],
            remise: 0,
            paiements: [
              { id: uuid('77777777', 1), moyen: 'ESPECES', montant: 300_000, reference: null },
            ],
            autorisationRemise: null,
          },
        },
        () => crypto.randomUUID(),
      );
      return numero;
    });
    expect(ms).toBeLessThan(300);
    // Le compteur a repris après les 5 000 factures connues.
    expect(await prochainNumeroFacture(base, 'MAD', APPAREIL)).toBe('MAD-3F2A9C-005002');
  });
});
