import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei } from '@gestvente/commun';
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
  corrections?: { entite: string; id: string; donnees: Record<string, unknown> | null }[];
}

describe('Synchronisation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let accessoireId: string;
  let telephoneId: string;
  let articleIds: string[];
  let gerant: SessionTest;
  let proprietaire: SessionTest;
  let vendeur: SessionTest;
  let vendeurB: SessionTest;

  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  const envoyer = async (session: SessionTest, operations: unknown[]) => {
    const reponse = await http()
      .post('/api/sync/operations')
      .auth(session.jetonAcces, bearer)
      .send({ operations })
      .expect(200);
    return reponse.body.resultats as ResultatOp[];
  };

  const operation = (type: string, contenu: unknown, boutiqueId = d.boutiqueA.id) => ({
    id: randomUUID(),
    type,
    boutiqueId,
    faiteLe: new Date().toISOString(),
    contenu,
  });

  const quantite = async (produitId: string, boutiqueId = d.boutiqueA.id) =>
    (
      await prisma.stock.findUniqueOrThrow({
        where: { produitId_boutiqueId: { produitId, boutiqueId } },
      })
    ).quantite;

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;

    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Coques', type: 'ACCESSOIRE' },
    });
    const categorieTel = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const accessoire = await prisma.produit.create({
      data: {
        commerceId,
        type: 'ACCESSOIRE',
        categorieId: categorie.id,
        nom: 'Coque test',
        prixAchat: 10_000,
        prixDetail: 25_000,
        prixGros: 20_000,
      },
    });
    const telephone = await prisma.produit.create({
      data: {
        commerceId,
        type: 'TELEPHONE',
        categorieId: categorieTel.id,
        nom: 'Téléphone test',
        prixAchat: 1_000_000,
        prixDetail: 1_300_000,
        prixGros: 1_200_000,
      },
    });
    accessoireId = accessoire.id;
    telephoneId = telephone.id;
    await prisma.stock.createMany({
      data: [
        { produitId: accessoireId, boutiqueId: d.boutiqueA.id, quantite: 10 },
        { produitId: accessoireId, boutiqueId: d.boutiqueB.id, quantite: 4 },
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
      ],
    });
    const base = String(Date.now()).slice(-8);
    articleIds = [];
    for (let i = 0; i < 3; i++) {
      const article = await prisma.article.create({
        data: {
          commerceId,
          produitId: telephoneId,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`35${base}${String(i).padStart(4, '0')}`),
          prixAchat: 1_000_000,
        },
      });
      articleIds.push(article.id);
    }

    gerant = await connecter(app, d.gerantA.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  describe('instantané', () => {
    it("donne le catalogue et le stock des boutiques de l'utilisateur", async () => {
      const { body } = await http()
        .get('/api/sync/instantane')
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);
      expect(body.donnees.produit).toHaveLength(2);
      expect(body.donnees.stock.map((s: { boutiqueId: string }) => s.boutiqueId)).toEqual([
        d.boutiqueA.id,
        d.boutiqueA.id,
      ]);
      expect(body.donnees.article).toHaveLength(3);
      expect(typeof body.curseur).toBe('number');
    });

    it("cache les prix d'achat aux vendeurs, pas au gérant", async () => {
      const pour = async (session: SessionTest) =>
        (await http().get('/api/sync/instantane').auth(session.jetonAcces, bearer).expect(200)).body
          .donnees;
      const vue = await pour(vendeur);
      expect(vue.produit.every((p: { prixAchat: unknown }) => p.prixAchat === null)).toBe(true);
      expect(vue.article.every((a: { prixAchat: unknown }) => a.prixAchat === null)).toBe(true);
      const vueGerant = await pour(gerant);
      expect(vueGerant.produit.find((p: { id: string }) => p.id === accessoireId).prixAchat).toBe(
        10_000,
      );
    });
  });

  describe('opérations', () => {
    it('applique un ajustement et le fait descendre aux autres appareils', async () => {
      const { body: avant } = await http()
        .get('/api/sync/instantane')
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);

      const op = operation('STOCK_AJUSTER', {
        produitId: accessoireId,
        delta: -2,
        motif: 'Casse en vitrine',
      });
      expect(await envoyer(gerant, [op])).toEqual([{ id: op.id, statut: 'APPLIQUEE' }]);
      expect(await quantite(accessoireId)).toBe(8);

      const mouvement = await prisma.mouvementStock.findFirst({ where: { referenceId: op.id } });
      expect(mouvement).toMatchObject({
        type: 'AJUSTEMENT',
        quantite: -2,
        motif: 'Casse en vitrine',
      });
      const audit = await prisma.journalAudit.findFirst({
        where: { action: 'AJUSTEMENT_STOCK', utilisateurId: d.gerantA.id },
      });
      expect(audit).not.toBeNull();

      const { body: page } = await http()
        .get('/api/sync/changements')
        .query({ curseur: avant.curseur })
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);
      expect(page.plus).toBe(false);
      expect(page.changements).toEqual([
        expect.objectContaining({
          entite: 'stock',
          donnees: expect.objectContaining({ produitId: accessoireId, quantite: 8 }),
        }),
      ]);
      expect(page.curseur).toBeGreaterThan(avant.curseur);

      // Rien de nouveau depuis le nouveau curseur.
      const { body: suivante } = await http()
        .get('/api/sync/changements')
        .query({ curseur: page.curseur })
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);
      expect(suivante.changements).toEqual([]);
      expect(suivante.curseur).toBe(page.curseur);
    });

    it('rejouer un lot ne rejoue rien : mêmes résultats, aucun double effet', async () => {
      const lot = [
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 5, motif: 'Recomptage' }),
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: -1, motif: 'Casse' }),
      ];
      const depart = await quantite(accessoireId);
      const premier = await envoyer(gerant, lot);
      const second = await envoyer(gerant, lot);
      expect(second).toEqual(premier);
      expect(await quantite(accessoireId)).toBe(depart + 4);
    });

    it("coupure au milieu d'un envoi : le lot renvoyé avec une nouvelle opération", async () => {
      const deja = operation('STOCK_AJUSTER', {
        produitId: accessoireId,
        delta: 1,
        motif: 'Retrouvé',
      });
      const depart = await quantite(accessoireId);
      // Réponse perdue : l'appareil ne sait pas que l'opération est passée.
      await envoyer(gerant, [deja]);
      const nouvelle = operation('STOCK_AJUSTER', {
        produitId: accessoireId,
        delta: 2,
        motif: 'Livraison',
      });
      const resultats = await envoyer(gerant, [deja, nouvelle]);
      expect(resultats.map((r) => r.statut)).toEqual(['APPLIQUEE', 'APPLIQUEE']);
      expect(await quantite(accessoireId)).toBe(depart + 3);
    });

    it('la même opération reçue deux fois en même temps ne s’applique qu’une fois', async () => {
      const op = operation('STOCK_AJUSTER', { produitId: accessoireId, delta: -1, motif: 'Casse' });
      const depart = await quantite(accessoireId);
      const [a, b] = await Promise.all([envoyer(gerant, [op]), envoyer(gerant, [op])]);
      expect(a).toEqual(b);
      expect(await quantite(accessoireId)).toBe(depart - 1);
    });

    it('deux appareils sortent le même IMEI : le second est en conflit, signalé au gérant', async () => {
      const articleId = articleIds[0];
      const premiere = operation('ARTICLE_SORTIR', { articleId, motif: 'Écran cassé' });
      const seconde = operation('ARTICLE_SORTIR', { articleId, motif: 'Volé en vitrine' });

      expect(await envoyer(gerant, [premiere])).toEqual([{ id: premiere.id, statut: 'APPLIQUEE' }]);
      const [conflit] = await envoyer(proprietaire, [seconde]);
      expect(conflit).toMatchObject({
        id: seconde.id,
        statut: 'CONFLIT',
        motif: 'Ce téléphone a déjà été sorti du stock.',
      });
      // L'appareil reçoit l'état du serveur pour corriger sa base locale.
      expect(conflit.corrections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            entite: 'article',
            id: articleId,
            donnees: expect.objectContaining({ statut: 'REBUT' }),
          }),
          expect.objectContaining({
            entite: 'stock',
            donnees: expect.objectContaining({ produitId: telephoneId, quantite: 2 }),
          }),
        ]),
      );

      const { body: conflits } = await http()
        .get('/api/sync/conflits')
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(conflits).toEqual([
        expect.objectContaining({
          id: seconde.id,
          type: 'ARTICLE_SORTIR',
          motif: 'Ce téléphone a déjà été sorti du stock.',
          utilisateur: { id: d.proprietaire.id, nom: d.proprietaire.nom },
        }),
      ]);
      await http().get('/api/sync/conflits').auth(vendeur.jetonAcces, bearer).expect(403);

      await http()
        .post(`/api/sync/conflits/${seconde.id}/traitement`)
        .auth(gerant.jetonAcces, bearer)
        .expect(204);
      const { body: apres } = await http()
        .get('/api/sync/conflits')
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(apres).toEqual([]);
    });

    it('les deux opérations simultanées sur un même IMEI : une seule passe', async () => {
      const articleId = articleIds[1];
      const [a, b] = await Promise.all([
        envoyer(gerant, [operation('ARTICLE_SORTIR', { articleId, motif: 'Casse' })]),
        envoyer(proprietaire, [operation('ARTICLE_SORTIR', { articleId, motif: 'Perte' })]),
      ]);
      expect([a[0].statut, b[0].statut].sort()).toEqual(['APPLIQUEE', 'CONFLIT']);
    });

    it('un ajustement qui rendrait le stock négatif est en conflit', async () => {
      const [r] = await envoyer(gerant, [
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: -1000, motif: 'Erreur' }),
      ]);
      expect(r.statut).toBe('CONFLIT');
      expect(r.motif).toMatch(/Stock insuffisant/);
    });

    it('rejette : rôle insuffisant, boutique non rattachée, contenu invalide, téléphone par quantité', async () => {
      const [role] = await envoyer(vendeur, [
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 1, motif: 'Essai' }),
      ]);
      expect(role).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/rôle/) });
      // L'appareil reçoit la quantité du serveur pour annuler sa modification locale.
      expect(role.corrections?.[0]).toMatchObject({ entite: 'stock' });

      const [boutique] = await envoyer(gerant, [
        operation(
          'STOCK_AJUSTER',
          { produitId: accessoireId, delta: 1, motif: 'Essai' },
          d.boutiqueB.id,
        ),
      ]);
      expect(boutique).toMatchObject({
        statut: 'REJETEE',
        motif: expect.stringMatching(/rattaché/),
      });

      const [contenu] = await envoyer(gerant, [
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 0, motif: 'Essai' }),
      ]);
      expect(contenu).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/nulle/) });

      const [telephone] = await envoyer(gerant, [
        operation('STOCK_AJUSTER', { produitId: telephoneId, delta: 1, motif: 'Essai' }),
      ]);
      expect(telephone).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/IMEI/) });
    });

    it("un identifiant d'opération ne peut pas être repris par un autre appareil", async () => {
      const op = operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 1, motif: 'Essai' });
      await envoyer(gerant, [op]);
      const [r] = await envoyer(proprietaire, [op]);
      expect(r).toMatchObject({
        statut: 'REJETEE',
        motif: "Identifiant d'opération déjà utilisé.",
      });
    });

    it('valide le lot', async () => {
      await http()
        .post('/api/sync/operations')
        .auth(gerant.jetonAcces, bearer)
        .send({ operations: [] })
        .expect(400);
      await http()
        .post('/api/sync/operations')
        .auth(gerant.jetonAcces, bearer)
        .send({ operations: [{ ...operation('INCONNU', {}) }] })
        .expect(400);
    });
  });

  describe('changements', () => {
    it("un vendeur ne reçoit pas les changements d'une autre boutique", async () => {
      const { body: avant } = await http()
        .get('/api/sync/instantane')
        .auth(vendeurB.jetonAcces, bearer)
        .expect(200);
      await envoyer(gerant, [
        operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 1, motif: 'Recomptage' }),
      ]);
      const { body } = await http()
        .get('/api/sync/changements')
        .query({ curseur: avant.curseur })
        .auth(vendeurB.jetonAcces, bearer)
        .expect(200);
      expect(body.changements).toEqual([]);
      // Le curseur avance quand même : ces changements ne le concernent pas.
      expect(body.curseur).toBeGreaterThan(avant.curseur);
    });

    it('pagine avec plus=true', async () => {
      const { body: avant } = await http()
        .get('/api/sync/instantane')
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      await envoyer(
        gerant,
        [1, 2, 3].map(() =>
          operation('STOCK_AJUSTER', { produitId: accessoireId, delta: 1, motif: 'Recomptage' }),
        ),
      );
      const page = async (curseur: number) =>
        (
          await http()
            .get('/api/sync/changements')
            .query({ curseur, limite: 2 })
            .auth(gerant.jetonAcces, bearer)
            .expect(200)
        ).body;
      const p1 = await page(avant.curseur);
      expect(p1.changements).toHaveLength(2);
      expect(p1.plus).toBe(true);
      const p2 = await page(p1.curseur);
      expect(p2.changements).toHaveLength(1);
      expect(p2.plus).toBe(false);
    });
  });
});
