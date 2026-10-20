import type {
  Changement,
  Instantane,
  Operation,
  ProduitSync,
  ResultatOperation,
  StockSync,
} from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErreurApi, ErreurReseau } from '../api';
import { lireMeta } from '../base/depot';
import { migrer, MIGRATIONS } from '../base/migrations';
import type { BaseSql } from '../base/sql';
import { baseEnMemoire } from '../base/sql-node.test-utils';
import { MoteurSync, type ServeurSync } from './moteur';
import { enregistrerOperation, ErreurOperation } from './operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
const COQUE = '22222222-2222-4222-8222-222222222222';
const STOCK = '33333333-3333-4333-8333-333333333333';

let compteur = 0;
const creerId = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const produit: ProduitSync = {
  id: COQUE,
  type: 'ACCESSOIRE',
  categorieId: 'cat',
  marqueId: null,
  modeleId: null,
  nom: 'Coque iPhone 13',
  capacite: null,
  couleur: null,
  etat: 'NEUF',
  codeBarres: '6200001',
  garantieMois: 0,
  prixAchat: null,
  prixDetail: 50_000,
  prixGros: 40_000,
  seuilGros: 10,
  archive: false,
  photo: null,
};
const stock = (quantite: number): StockSync => ({
  id: STOCK,
  produitId: COQUE,
  boutiqueId: BOUTIQUE,
  quantite,
  seuilMinimum: 2,
});

const instantane: Instantane = {
  curseur: 10,
  donnees: {
    marque: [],
    modele: [],
    categorie: [{ id: 'cat', nom: 'Coques', type: 'ACCESSOIRE' }],
    produit: [produit],
    prixBoutique: [],
    compatibilite: [],
    stock: [stock(10)],
    article: [],
    client: [],
    garant: [],
    fournisseur: [],
    achat: [],
    ligneAchat: [],
    vente: [],
    ligneVente: [],
    paiementVente: [],
    retour: [],
    ligneRetour: [],
    caisse: [],
    depense: [],
  },
};

/** Serveur simulé : enregistre ce qu'il reçoit, répond selon le scénario du test. */
class ServeurFactice implements ServeurSync {
  recus: Operation[][] = [];
  dejaAppliquees = new Set<string>();
  resultats = new Map<string, ResultatOperation>();
  changements: Changement[] = [];
  /** La réponse à l'envoi se perd (après traitement par le serveur). */
  coupure = false;
  hors = false;
  /** Lot entier refusé (400) s'il contient cette opération. */
  malFormee: string | null = null;
  avantChangements?: () => Promise<void>;
  instantanes = 0;

  async requete<T>(
    chemin: string,
    options: { methode?: string; corps?: unknown } = {},
  ): Promise<T> {
    if (this.hors) throw new ErreurReseau();
    if (chemin === '/sync/instantane') {
      this.instantanes++;
      return instantane as T;
    }
    if (chemin.startsWith('/sync/changements')) {
      await this.avantChangements?.();
      this.avantChangements = undefined;
      const curseur = Number(new URL(`http://x${chemin}`).searchParams.get('curseur'));
      const suivants = this.changements.filter((c) => c.seq > curseur);
      const fin = Math.max(curseur, ...this.changements.map((c) => c.seq));
      return { changements: suivants, curseur: fin, plus: false } as T;
    }
    if (chemin === '/sync/operations' && options.methode === 'POST') {
      const { operations } = options.corps as { operations: Operation[] };
      if (this.malFormee && operations.some((o) => o.id === this.malFormee)) {
        throw new ErreurApi(400, 'contenu invalide');
      }
      this.recus.push(operations);
      const resultats = operations.map((o) => {
        this.dejaAppliquees.add(o.id);
        return this.resultats.get(o.id) ?? { id: o.id, statut: 'APPLIQUEE' as const };
      });
      if (this.coupure) {
        this.coupure = false;
        throw new ErreurReseau();
      }
      return { resultats } as T;
    }
    throw new Error(`Route inattendue : ${chemin}`);
  }
}

const quantiteLocale = async (base: BaseSql) =>
  (
    await base.premier<{ quantite: number }>('SELECT quantite FROM stock WHERE produitId = ?', [
      COQUE,
    ])
  )?.quantite;

const ajuster = (base: BaseSql, delta: number) =>
  enregistrerOperation(
    base,
    {
      type: 'STOCK_AJUSTER',
      boutiqueId: BOUTIQUE,
      contenu: { produitId: COQUE, delta, motif: 'Recomptage' },
    },
    creerId,
  );

describe('base locale', () => {
  it('après une migration, oublie le curseur pour reprendre un instantané complet', async () => {
    const base = baseEnMemoire();
    await migrer(base);
    await base.executer("INSERT OR REPLACE INTO meta (cle, valeur) VALUES ('curseur', '42')");
    // Simule une base restée à la version 1.
    await base.executer('PRAGMA user_version = 1');
    await base.executer('DROP TABLE client');
    await base.executer('DROP TABLE garant');
    await base.executer('DROP TABLE fournisseur');
    await base.executer('DROP TABLE achat');
    await base.executer('DROP TABLE ligneAchat');
    await base.executer('DROP TABLE vente');
    await base.executer('DROP TABLE ligneVente');
    await base.executer('DROP TABLE paiementVente');
    await base.executer('DROP TABLE retour');
    await base.executer('DROP TABLE ligneRetour');
    await base.executer('DROP TABLE caisse');
    await base.executer('DROP TABLE depense');
    await base.executer('DROP INDEX article_boutique_imei');
    await base.executer('ALTER TABLE produit DROP COLUMN photo');
    await base.executer('ALTER TABLE produit DROP COLUMN recherche');
    await migrer(base);
    expect(await lireMeta(base, 'curseur')).toBeNull();
  });

  it('applique les migrations une seule fois', async () => {
    const base = baseEnMemoire();
    expect(await migrer(base)).toBe(MIGRATIONS.length);
    expect(await migrer(base)).toBe(MIGRATIONS.length);
    const version = await base.premier<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(MIGRATIONS.length);
  });
});

describe('synchronisation', () => {
  let base: BaseSql;
  let serveur: ServeurFactice;
  let moteur: MoteurSync;

  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
    serveur = new ServeurFactice();
    moteur = new MoteurSync(base, serveur);
    await moteur.synchroniser();
  });

  it('remplit la base vide avec un instantané, puis suit les changements', async () => {
    expect(serveur.instantanes).toBe(1);
    expect(await quantiteLocale(base)).toBe(10);
    expect(await lireMeta(base, 'curseur')).toBe('10');
    expect(moteur.lireEtat()).toMatchObject({ reseau: 'en-ligne', enAttente: 0 });

    serveur.changements = [{ seq: 11, entite: 'stock', id: STOCK, donnees: stock(7) }];
    await moteur.synchroniser();
    expect(serveur.instantanes).toBe(1);
    expect(await quantiteLocale(base)).toBe(7);
    expect(await lireMeta(base, 'curseur')).toBe('11');
  });

  it("enregistre l'effet local et l'opération dans la même transaction", async () => {
    await ajuster(base, -3);
    expect(await quantiteLocale(base)).toBe(7);
    const file = await base.tous<{ type: string; statut: string }>(
      'SELECT type, statut FROM operation',
    );
    expect(file).toEqual([{ type: 'STOCK_AJUSTER', statut: 'EN_ATTENTE' }]);

    // Refus local : ni effet, ni opération en file.
    await expect(ajuster(base, -50)).rejects.toThrow(ErreurOperation);
    await expect(ajuster(base, 0)).rejects.toThrow(/nulle/);
    expect(await quantiteLocale(base)).toBe(7);
    expect(await base.tous('SELECT id FROM operation')).toHaveLength(1);
  });

  it('hors ligne : les opérations attendent, puis partent au retour du réseau', async () => {
    serveur.hors = true;
    await ajuster(base, -1);
    await ajuster(base, -1);
    await moteur.synchroniser();
    expect(moteur.lireEtat()).toMatchObject({ reseau: 'hors-ligne', enAttente: 2 });
    expect(await quantiteLocale(base)).toBe(8);

    serveur.hors = false;
    await moteur.synchroniser();
    expect(moteur.lireEtat()).toMatchObject({ reseau: 'en-ligne', enAttente: 0 });
    expect(serveur.recus.flat().map((o) => o.type)).toEqual(['STOCK_AJUSTER', 'STOCK_AJUSTER']);
  });

  it("coupure au milieu d'un envoi : le même lot est renvoyé, sans nouvel identifiant", async () => {
    const op = await ajuster(base, -2);
    serveur.coupure = true;
    await moteur.synchroniser();
    expect(moteur.lireEtat().enAttente).toBe(1);

    await moteur.synchroniser();
    expect(serveur.recus.map((lot) => lot.map((o) => o.id))).toEqual([[op.id], [op.id]]);
    expect(moteur.lireEtat().enAttente).toBe(0);
  });

  it("conflit : l'opération est signalée et l'état du serveur remplace l'effet local", async () => {
    const op = await ajuster(base, -4);
    expect(await quantiteLocale(base)).toBe(6);
    serveur.resultats.set(op.id, {
      id: op.id,
      statut: 'CONFLIT',
      motif: 'Stock insuffisant',
      corrections: [{ seq: 0, entite: 'stock', id: STOCK, donnees: stock(3) }],
    });
    await moteur.synchroniser();
    expect(await quantiteLocale(base)).toBe(3);
    expect(moteur.lireEtat()).toMatchObject({ enAttente: 0, refusees: 0, enConflit: 1 });
    expect(await base.tous('SELECT statut, motif FROM operation')).toEqual([
      { statut: 'CONFLIT', motif: 'Stock insuffisant' },
    ]);

    await moteur.effacerRefusees();
    expect(moteur.lireEtat().enConflit).toBe(0);
  });

  it("n'écrase pas une opération créée pendant la synchronisation", async () => {
    serveur.changements = [{ seq: 11, entite: 'stock', id: STOCK, donnees: stock(9) }];
    // Une vente d'accessoire arrive pendant que l'appareil télécharge les changements.
    serveur.avantChangements = async () => {
      await ajuster(base, -1);
    };
    await moteur.synchroniser();
    // L'opération est partie au tour suivant, puis la descente a été appliquée.
    expect(serveur.recus.flat()).toHaveLength(1);
    expect(moteur.lireEtat().enAttente).toBe(0);
    expect(await lireMeta(base, 'curseur')).toBe('11');
  });

  it('isole une opération mal formée qui ferait refuser tout le lot', async () => {
    const bonne = await ajuster(base, -1);
    const mauvaise = await ajuster(base, -1);
    serveur.malFormee = mauvaise.id;
    await moteur.synchroniser();
    expect(serveur.recus.flat().map((o) => o.id)).toEqual([bonne.id]);
    expect(await base.tous('SELECT id, statut FROM operation')).toEqual([
      { id: mauvaise.id, statut: 'REJETEE' },
    ]);
  });
});
