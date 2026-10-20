import { completerImei, type ProduitSync } from '@gestvente/commun';
import { beforeAll, describe, expect, it } from 'vitest';
import { completerRecherche, ecrireEntite } from './base/depot';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { rechercherProduits, trouverParCode } from './catalogue';
import { enregistrerOperation, ErreurOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const AUTRE_BOUTIQUE = '99999999-9999-4999-8999-999999999999';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const produit = (surcharge: Partial<ProduitSync>): ProduitSync => ({
  id: uuid(),
  type: 'ACCESSOIRE',
  categorieId: 'cat',
  marqueId: null,
  modeleId: null,
  nom: 'Produit',
  capacite: null,
  couleur: null,
  etat: 'NEUF',
  codeBarres: null,
  garantieMois: 0,
  prixAchat: 100,
  prixDetail: 200,
  prixGros: 150,
  seuilGros: null,
  archive: false,
  photo: null,
  ...surcharge,
});

async function nouvelleBase(): Promise<BaseSql> {
  const base = baseEnMemoire();
  await migrer(base);
  return base;
}

describe('recherche locale', () => {
  let base: BaseSql;
  const galaxy = produit({
    nom: 'Samsung Galaxy A15',
    capacite: '128 Go',
    couleur: 'Noir',
    type: 'TELEPHONE',
  });
  const cable = produit({ nom: 'Câble USB-C 1 m', codeBarres: '6200001001' });
  const archive = produit({ nom: 'Câble ancien modèle', archive: true });
  const imei = completerImei('35209900000001');

  beforeAll(async () => {
    base = await nouvelleBase();
    for (const p of [galaxy, cable, archive]) await ecrireEntite(base, 'produit', p.id, p);
    await ecrireEntite(base, 'article', 'a1', {
      id: 'a1',
      produitId: galaxy.id,
      boutiqueId: BOUTIQUE,
      imei,
      imei2: null,
      numeroSerie: null,
      statut: 'EN_STOCK',
      origine: 'ACHAT',
      prixAchat: null,
      prixRevente: null,
    });
    await ecrireEntite(base, 'prixBoutique', 'pb', {
      id: 'pb',
      produitId: cable.id,
      boutiqueId: BOUTIQUE,
      prixAchat: null,
      prixDetail: 250,
      prixGros: null,
    });
  });

  const noms = async (terme: string, archives = false) =>
    (await rechercherProduits(base, BOUTIQUE, terme, { archives })).map((p) => p.nom);

  it('trouve par mots, sans accents ni casse, dans n’importe quel ordre', async () => {
    expect(await noms('cable usb')).toEqual(['Câble USB-C 1 m']);
    expect(await noms('noir galaxy')).toEqual(['Samsung Galaxy A15']);
    expect(await noms('128')).toEqual(['Samsung Galaxy A15']);
    expect(await noms('iphone')).toEqual([]);
  });

  it('trouve par code-barres ou IMEI exact, et cache les produits archivés', async () => {
    expect(await noms('6200001001')).toEqual(['Câble USB-C 1 m']);
    expect(await noms(imei)).toEqual(['Samsung Galaxy A15']);
    expect(await noms('câble')).toEqual(['Câble USB-C 1 m']);
    expect(await noms('câble', true)).toEqual(['Câble ancien modèle', 'Câble USB-C 1 m']);
  });

  it('applique les prix de la boutique', async () => {
    const [p] = await rechercherProduits(base, BOUTIQUE, 'cable usb');
    expect(p.prixDetail).toBe(250);
    const [ailleurs] = await rechercherProduits(base, AUTRE_BOUTIQUE, 'cable usb');
    expect(ailleurs.prixDetail).toBe(200);
  });

  it('un code lu au scanner mène au produit (et au téléphone pour un IMEI)', async () => {
    expect(await trouverParCode(base, BOUTIQUE, '6200001001')).toEqual({
      produitId: cable.id,
      articleId: null,
    });
    expect(await trouverParCode(base, BOUTIQUE, imei)).toEqual({
      produitId: galaxy.id,
      articleId: 'a1',
    });
    expect(await trouverParCode(base, AUTRE_BOUTIQUE, imei)).toBeNull();
    expect(await trouverParCode(base, BOUTIQUE, 'inconnu')).toBeNull();
  });

  it('complète le texte de recherche des produits reçus avant la migration', async () => {
    await base.executer('UPDATE produit SET recherche = NULL');
    await completerRecherche(base);
    expect(await noms('galaxy')).toEqual(['Samsung Galaxy A15']);
  });

  it('répond en moins d’une seconde sur 10 000 produits et 20 000 IMEI', async () => {
    const grande = await nouvelleBase();
    await grande.transaction(async (tx) => {
      for (let i = 0; i < 10_000; i++) {
        const p = produit({ nom: `Article ${i} modèle ${i % 97}`, codeBarres: `CB${i}` });
        await ecrireEntite(tx, 'produit', p.id, p);
        for (let j = 0; j < 2; j++) {
          await tx.executer(
            "INSERT INTO article (id, produitId, boutiqueId, imei, statut, origine) VALUES (?, ?, ?, ?, 'EN_STOCK', 'ACHAT')",
            [`${p.id}-${j}`, p.id, BOUTIQUE, completerImei(String(35_000_000_000_000 + i * 2 + j))],
          );
        }
      }
    });
    const debut = performance.now();
    const parMots = await rechercherProduits(grande, BOUTIQUE, 'modele 42');
    const parImei = await rechercherProduits(
      grande,
      BOUTIQUE,
      completerImei(String(35_000_000_000_000 + 1234)),
    );
    const parCode = await trouverParCode(grande, BOUTIQUE, 'CB9999');
    const duree = performance.now() - debut;
    expect(parMots.length).toBeGreaterThan(0);
    expect(parImei).toHaveLength(1);
    expect(parCode).not.toBeNull();
    expect(duree).toBeLessThan(1000);
  });
});

describe('opérations du catalogue (effet local)', () => {
  it('crée marque, catégorie et produit ; refuse les doublons comme le serveur', async () => {
    const base = await nouvelleBase();
    const marqueId = uuid();
    const categorieId = uuid();
    await enregistrerOperation(
      base,
      {
        type: 'MARQUE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        contenu: { id: marqueId, nom: 'Oraimo' },
      },
      uuid,
    );
    await expect(
      enregistrerOperation(
        base,
        {
          type: 'MARQUE_ENREGISTRER',
          boutiqueId: BOUTIQUE,
          contenu: { id: uuid(), nom: 'ORAIMO' },
        },
        uuid,
      ),
    ).rejects.toThrow(/existe déjà/);
    await enregistrerOperation(
      base,
      {
        type: 'CATEGORIE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        contenu: { id: categorieId, nom: 'Chargeurs', type: 'ACCESSOIRE' },
      },
      uuid,
    );
    const modeleId = uuid();
    const contenu = {
      id: uuid(),
      type: 'ACCESSOIRE' as const,
      categorieId,
      marqueId,
      modeleId: null,
      nom: 'Chargeur Oraimo 20 W',
      capacite: '',
      couleur: null,
      etat: 'NEUF' as const,
      codeBarres: 'OR20W',
      garantieMois: 3,
      prixAchat: 60_000,
      prixDetail: 110_000,
      prixGros: 90_000,
      seuilGros: 10,
      archive: false,
      compatibles: [modeleId],
    };
    await enregistrerOperation(
      base,
      { type: 'PRODUIT_ENREGISTRER', boutiqueId: BOUTIQUE, contenu },
      uuid,
    );
    expect(
      await base.premier('SELECT nom, capacite, recherche FROM produit WHERE id = ?', [contenu.id]),
    ).toEqual({
      nom: 'Chargeur Oraimo 20 W',
      capacite: null,
      recherche: 'chargeur oraimo 20 w or20w',
    });
    expect(await base.tous('SELECT modeleId FROM compatibilite')).toEqual([{ modeleId }]);

    await expect(
      enregistrerOperation(
        base,
        {
          type: 'PRODUIT_ENREGISTRER',
          boutiqueId: BOUTIQUE,
          contenu: { ...contenu, id: uuid(), nom: 'Autre' },
        },
        uuid,
      ),
    ).rejects.toThrow(ErreurOperation);
    await expect(
      enregistrerOperation(
        base,
        {
          type: 'PRODUIT_ENREGISTRER',
          boutiqueId: BOUTIQUE,
          contenu: { ...contenu, prixGros: 999_999 },
        },
        uuid,
      ),
    ).rejects.toThrow(/gros/);
  });

  it('prix de la boutique : ligne provisoire, puis retour aux prix communs', async () => {
    const base = await nouvelleBase();
    const produitId = uuid();
    const contenu = { produitId, prixAchat: null, prixDetail: 5_000, prixGros: null };
    await enregistrerOperation(
      base,
      { type: 'PRIX_BOUTIQUE_ENREGISTRER', boutiqueId: BOUTIQUE, contenu },
      uuid,
    );
    expect(await base.premier('SELECT id, prixDetail FROM prixBoutique')).toEqual({
      id: `provisoire:${produitId}:${BOUTIQUE}`,
      prixDetail: 5_000,
    });
    await enregistrerOperation(
      base,
      {
        type: 'PRIX_BOUTIQUE_ENREGISTRER',
        boutiqueId: BOUTIQUE,
        contenu: { ...contenu, prixDetail: null },
      },
      uuid,
    );
    expect(await base.tous('SELECT id FROM prixBoutique')).toEqual([]);
  });
});
