import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  connecter,
  creerCommerce,
  demarrerApplication,
  prismaDe,
  type SessionTest,
  supprimerCommerce,
} from './outils.js';

interface ResultatOp {
  id: string;
  statut: string;
  motif?: string;
  corrections?: { entite: string; id: string; donnees: unknown }[];
}

describe('Catalogue (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  const categorieTel = randomUUID();
  const categorieAcc = randomUUID();
  const marque = randomUUID();
  const modeleA15 = randomUUID();
  const modeleA25 = randomUUID();
  const telephone = randomUUID();
  const coque = randomUUID();

  const op = (type: string, contenu: unknown, boutiqueId = d.boutiqueA.id) => ({
    id: randomUUID(),
    type,
    boutiqueId,
    faiteLe: new Date().toISOString(),
    contenu,
  });

  const envoyer = async (session: SessionTest, operations: unknown[]) =>
    (
      await http()
        .post('/api/sync/operations')
        .auth(session.jetonAcces, bearer)
        .send({ operations })
        .expect(200)
    ).body.resultats as ResultatOp[];

  const produit = (surcharge: Record<string, unknown> = {}) => ({
    id: coque,
    type: 'ACCESSOIRE',
    categorieId: categorieAcc,
    marqueId: null,
    modeleId: null,
    nom: 'Coque anti-casse Galaxy A15',
    capacite: null,
    couleur: null,
    etat: 'NEUF',
    codeBarres: `62${Date.now()}`.slice(0, 13),
    garantieMois: 0,
    prixAchat: 15_000,
    prixDetail: 35_000,
    prixGros: 27_000,
    seuilGros: 10,
    archive: false,
    compatibles: [modeleA15],
    ...surcharge,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('crée catégories, marque, modèles et produits, qui descendent aux appareils', async () => {
    const { body: avant } = await http()
      .get('/api/sync/instantane')
      .auth(vendeur.jetonAcces, bearer)
      .expect(200);

    const resultats = await envoyer(gerant, [
      op('CATEGORIE_ENREGISTRER', { id: categorieTel, nom: 'Téléphones', type: 'TELEPHONE' }),
      op('CATEGORIE_ENREGISTRER', { id: categorieAcc, nom: 'Coques', type: 'ACCESSOIRE' }),
      op('MARQUE_ENREGISTRER', { id: marque, nom: 'Samsung' }),
      op('MODELE_ENREGISTRER', { id: modeleA15, marqueId: marque, nom: 'Galaxy A15' }),
      op('MODELE_ENREGISTRER', { id: modeleA25, marqueId: marque, nom: 'Galaxy A25' }),
      op('PRODUIT_ENREGISTRER', {
        ...produit(),
        id: telephone,
        type: 'TELEPHONE',
        categorieId: categorieTel,
        marqueId: marque,
        modeleId: modeleA15,
        nom: 'Samsung Galaxy A15 128 Go Noir',
        capacite: '128 Go',
        couleur: 'Noir',
        codeBarres: null,
        garantieMois: 12,
        prixAchat: 1_600_000,
        prixDetail: 1_900_000,
        prixGros: 1_780_000,
        seuilGros: 5,
        compatibles: [],
      }),
      op('PRODUIT_ENREGISTRER', produit()),
    ]);
    expect(resultats.map((r) => [r.statut, r.motif])).toEqual(
      resultats.map(() => ['APPLIQUEE', undefined]),
    );

    const { body: page } = await http()
      .get('/api/sync/changements')
      .query({ curseur: avant.curseur })
      .auth(vendeur.jetonAcces, bearer)
      .expect(200);
    const entites = page.changements.map((c: { entite: string }) => c.entite);
    expect(entites).toEqual(
      expect.arrayContaining(['categorie', 'marque', 'modele', 'produit', 'compatibilite']),
    );
    const coqueVue = page.changements.find((c: { id: string }) => c.id === coque);
    // Le vendeur ne reçoit pas le prix d'achat.
    expect(coqueVue.donnees).toMatchObject({ prixDetail: 35_000, prixAchat: null, photo: null });

    const journal = await prisma.journalAudit.findFirst({
      where: { action: 'PRODUIT_CREE', entiteId: coque },
    });
    expect(journal?.utilisateurId).toBe(d.gerantA.id);
  });

  it('un changement de prix est inscrit au journal d’audit (avant, après)', async () => {
    const [r] = await envoyer(gerant, [op('PRODUIT_ENREGISTRER', produit({ prixDetail: 40_000 }))]);
    expect(r.statut).toBe('APPLIQUEE');
    const journal = await prisma.journalAudit.findFirst({
      where: { action: 'PRIX_MODIFIE', entiteId: coque },
      orderBy: { creeLe: 'desc' },
    });
    expect(journal?.details).toMatchObject({
      avant: { prixDetail: 35_000 },
      apres: { prixDetail: 40_000 },
    });
  });

  it('met à jour les compatibilités (ajout et retrait)', async () => {
    await envoyer(gerant, [op('PRODUIT_ENREGISTRER', produit({ compatibles: [modeleA25] }))]);
    const compatibilites = await prisma.compatibilite.findMany({ where: { accessoireId: coque } });
    expect(compatibilites.map((c) => c.modeleId)).toEqual([modeleA25]);
  });

  it('refuse : vendeur, doublons, type changé, catégorie d’un autre type, gros > détail', async () => {
    const [vendeurRefus] = await envoyer(vendeur, [
      op('PRODUIT_ENREGISTRER', produit({ prixDetail: 1, prixGros: 1 })),
    ]);
    expect(vendeurRefus).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/rôle/) });
    // L'appareil reçoit la fiche du serveur pour annuler sa modification locale.
    expect(vendeurRefus.corrections?.[0]).toMatchObject({ entite: 'produit', id: coque });

    const existant = await prisma.produit.findUniqueOrThrow({ where: { id: coque } });
    const [doublonCode] = await envoyer(gerant, [
      op(
        'PRODUIT_ENREGISTRER',
        produit({
          id: randomUUID(),
          nom: 'Autre coque',
          compatibles: [],
          codeBarres: existant.codeBarres,
        }),
      ),
    ]);
    expect(doublonCode.motif).toMatch(/Code-barres déjà utilisé/);

    const [doublonMarque] = await envoyer(gerant, [
      op('MARQUE_ENREGISTRER', { id: randomUUID(), nom: 'SAMSUNG' }),
    ]);
    expect(doublonMarque.motif).toMatch(/existe déjà/);

    const [type] = await envoyer(gerant, [
      op(
        'PRODUIT_ENREGISTRER',
        produit({ type: 'TELEPHONE', categorieId: categorieTel, compatibles: [] }),
      ),
    ]);
    expect(type.motif).toMatch(/type/);

    const [categorie] = await envoyer(gerant, [
      op(
        'PRODUIT_ENREGISTRER',
        produit({ id: randomUUID(), categorieId: categorieTel, codeBarres: null, compatibles: [] }),
      ),
    ]);
    expect(categorie.motif).toMatch(/réservée aux téléphones/);

    const [gros] = await envoyer(gerant, [
      op('PRODUIT_ENREGISTRER', produit({ prixGros: 99_000 })),
    ]);
    expect(gros.motif).toMatch(/gros/);
  });

  it('prix propres à une boutique, puis retour aux prix communs', async () => {
    const [r] = await envoyer(gerant, [
      op('PRIX_BOUTIQUE_ENREGISTRER', {
        produitId: coque,
        prixAchat: null,
        prixDetail: 45_000,
        prixGros: null,
      }),
    ]);
    expect(r.statut).toBe('APPLIQUEE');
    const { body } = await http()
      .get('/api/sync/instantane')
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(body.donnees.prixBoutique).toEqual([
      expect.objectContaining({ produitId: coque, boutiqueId: d.boutiqueA.id, prixDetail: 45_000 }),
    ]);

    await envoyer(gerant, [
      op('PRIX_BOUTIQUE_ENREGISTRER', {
        produitId: coque,
        prixAchat: null,
        prixDetail: null,
        prixGros: null,
      }),
    ]);
    expect(await prisma.prixBoutique.count({ where: { produitId: coque } })).toBe(0);

    // Gros au-dessus du détail de la boutique : refusé.
    const [refus] = await envoyer(gerant, [
      op('PRIX_BOUTIQUE_ENREGISTRER', {
        produitId: coque,
        prixAchat: null,
        prixDetail: null,
        prixGros: 99_000,
      }),
    ]);
    expect(refus.statut).toBe('REJETEE');
  });

  describe('photos', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);

    it('enregistre la photo, la sert publiquement et la remplace', async () => {
      const { body } = await http()
        .put(`/api/catalogue/produits/${coque}/photo`)
        .auth(gerant.jetonAcces, bearer)
        .attach('photo', jpeg, { filename: 'coque.jpg', contentType: 'image/jpeg' })
        .expect(200);
      expect(body.photo).toMatch(/\.jpg$/);

      const servie = await http().get(`/api/photos/${body.photo}`).expect(200);
      expect(servie.headers['content-type']).toBe('image/jpeg');
      expect(servie.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(servie.body as Buffer, jpeg)).toBe(0);

      const { body: seconde } = await http()
        .put(`/api/catalogue/produits/${coque}/photo`)
        .auth(gerant.jetonAcces, bearer)
        .attach('photo', jpeg, { filename: 'coque.jpg', contentType: 'image/jpeg' })
        .expect(200);
      // L'ancienne photo est supprimée.
      await http().get(`/api/photos/${body.photo}`).expect(404);
      await http().get(`/api/photos/${seconde.photo}`).expect(200);

      await http()
        .delete(`/api/catalogue/produits/${coque}/photo`)
        .auth(gerant.jetonAcces, bearer)
        .expect(204);
      await http().get(`/api/photos/${seconde.photo}`).expect(404);
    });

    it('refuse un fichier qui n’est pas une image, un vendeur et un nom de fichier forgé', async () => {
      await http()
        .put(`/api/catalogue/produits/${coque}/photo`)
        .auth(gerant.jetonAcces, bearer)
        .attach('photo', Buffer.from('<script>alert(1)</script>'), {
          filename: 'x.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      await http()
        .put(`/api/catalogue/produits/${coque}/photo`)
        .auth(vendeur.jetonAcces, bearer)
        .attach('photo', jpeg, { filename: 'coque.jpg', contentType: 'image/jpeg' })
        .expect(403);
      await http().get('/api/photos/..%2F..%2F.env').expect(404);
    });
  });

  describe('import Excel', () => {
    const classeur = async (lignes: unknown[][]) => {
      const c = new ExcelJS.Workbook();
      const f = c.addWorksheet('Catalogue');
      f.addRow([
        'Type',
        'Catégorie',
        'Marque',
        'Modèle',
        'Nom',
        'Capacité',
        'Couleur',
        'État',
        'Code-barres',
        'Garantie (mois)',
        'Prix d’achat',
        'Prix de détail',
        'Prix de gros',
        'Seuil de gros',
      ]);
      lignes.forEach((l) => f.addRow(l));
      return Buffer.from(await c.xlsx.writeBuffer());
    };
    const importer = (fichier: Buffer, simulation: boolean) =>
      http()
        .post('/api/catalogue/import')
        .query({ simulation })
        .auth(gerant.jetonAcces, bearer)
        .attach('fichier', fichier, { filename: 'catalogue.xlsx' });

    const lignes = [
      [
        'Téléphone',
        'Téléphones',
        'Tecno',
        'Spark 20',
        '',
        '128 Go',
        'Bleu',
        'Neuf',
        '',
        6,
        1250000,
        1500000,
        1400000,
        5,
      ],
      [
        'Accessoire',
        'Chargeurs',
        '',
        '',
        'Chargeur 20 W',
        '',
        '',
        '',
        'CH20W-01',
        0,
        '15 000',
        35000,
        27000,
        '',
      ],
      ['Gadget', 'Divers', '', '', 'Erreur de type', '', '', '', '', 0, 1, 2, 1, ''],
      ['Accessoire', 'Coques', '', '', 'Prix faux', '', '', '', '', 0, 'beaucoup', 2, 1, ''],
      ['Accessoire', 'Coques', '', '', 'Gros trop cher', '', '', '', '', 0, 1000, 2000, 3000, ''],
    ];

    it('simulation : rapport des lignes en erreur, rien d’enregistré', async () => {
      const { body } = await importer(await classeur(lignes), true).expect(200);
      expect(body).toMatchObject({ simulation: true, lignes: 5, crees: 2, modifies: 0 });
      expect(body.erreurs.map((e: { ligne: number }) => e.ligne)).toEqual([4, 5, 6]);
      expect(body.erreurs[0].messages[0]).toMatch(/Type/);
      expect(body.erreurs[1].messages[0]).toMatch(/entier/);
      expect(body.erreurs[2].messages[0]).toMatch(/gros/);
      expect(
        await prisma.produit.count({ where: { commerceId: d.commerce.id, nom: 'Chargeur 20 W' } }),
      ).toBe(0);
      expect(
        await prisma.marque.count({ where: { commerceId: d.commerce.id, nom: 'Tecno' } }),
      ).toBe(0);
    });

    it('import réel puis réimport : création, puis mise à jour par code-barres ou nom', async () => {
      const premier = await importer(await classeur(lignes), false).expect(200);
      expect(premier.body).toMatchObject({ simulation: false, crees: 2, modifies: 0 });
      const spark = await prisma.produit.findFirstOrThrow({
        where: { commerceId: d.commerce.id, nom: 'Tecno Spark 20 128 Go Bleu' },
        include: { modele: true, marque: true },
      });
      expect(spark).toMatchObject({ garantieMois: 6, prixDetail: 1_500_000n });
      expect(spark.modele?.nom).toBe('Spark 20');
      expect(spark.marque?.nom).toBe('Tecno');

      const modifiees = lignes.slice(0, 2).map((l) => [...l]);
      modifiees[0][11] = 1_550_000;
      modifiees[1][11] = 36_000;
      const second = await importer(await classeur(modifiees), false).expect(200);
      expect(second.body).toMatchObject({ crees: 0, modifies: 2, erreurs: [] });
      const chargeur = await prisma.produit.findFirstOrThrow({
        where: { commerceId: d.commerce.id, codeBarres: 'CH20W-01' },
      });
      expect(chargeur.prixDetail).toBe(36_000n);
      expect(
        await prisma.journalAudit.count({
          where: { commerceId: d.commerce.id, action: 'IMPORT_CATALOGUE' },
        }),
      ).toBe(2);
    });

    it('refuse un fichier illisible ou sans les colonnes obligatoires, et un vendeur', async () => {
      await importer(Buffer.from('pas un classeur'), true).expect(400);
      const c = new ExcelJS.Workbook();
      c.addWorksheet('X').addRow(['Nom']);
      const { body } = await importer(Buffer.from(await c.xlsx.writeBuffer()), true).expect(400);
      expect(body.message).toMatch(/Colonnes manquantes/);
      await http()
        .post('/api/catalogue/import')
        .auth(vendeur.jetonAcces, bearer)
        .attach('fichier', await classeur([]), { filename: 'c.xlsx' })
        .expect(403);
    });

    it('fournit le classeur modèle', async () => {
      const reponse = await http()
        .get('/api/catalogue/import/modele')
        .auth(gerant.jetonAcces, bearer)
        .buffer(true)
        .parse((res, fin) => {
          const morceaux: Buffer[] = [];
          res.on('data', (m: Buffer) => morceaux.push(m));
          res.on('end', () => fin(null, Buffer.concat(morceaux)));
        })
        .expect(200);
      const c = new ExcelJS.Workbook();
      await c.xlsx.load(reponse.body as unknown as ArrayBuffer);
      expect(c.worksheets[0].getRow(1).getCell(1).value).toBe('Type');
    });
  });
});
