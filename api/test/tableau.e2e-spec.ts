import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei } from '@gestvente/commun';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  minuitLocal,
  periodesCompletes,
  RapportsPlanifiesService,
} from '../src/tableau/rapports-planifies.service.js';
import {
  connecter,
  creerCommerce,
  demarrerApplication,
  prismaDe,
  type SessionTest,
  supprimerCommerce,
} from './outils.js';

describe('Tableau de bord consolidé (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerantA: SessionTest;
  let vendeurA: SessionTest;
  let vendeurB: SessionTest;
  let telephoneId: string;
  let coqueId: string;
  let articles: string[];
  let client: string;
  let trocArticle: string;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);
  let n = 0;
  let imeis = 0;
  const imei = () => completerImei(`91${base}${String(++imeis).padStart(4, '0')}`);

  const operation = async (s: SessionTest, boutiqueId: string, type: string, contenu: object) => {
    const { body } = await http()
      .post('/api/sync/operations')
      .auth(s.jetonAcces, bearer)
      .send({
        operations: [
          { id: randomUUID(), type, boutiqueId, faiteLe: new Date().toISOString(), contenu },
        ],
      })
      .expect(200);
    expect(body.resultats[0]).toMatchObject({ statut: 'APPLIQUEE' });
  };
  const vente = (lignes: object[], total: number, extra: object = {}) => ({
    id: randomUUID(),
    numero: `TB-${base}-${++n}`,
    dateVente: new Date().toISOString(),
    clientId: null,
    lignes,
    remise: 0,
    paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: total, reference: null }],
    autorisationRemise: null,
    ...extra,
  });
  const ligne = (
    produitId: string,
    prixUnitaire: number,
    articleId: string | null,
    quantite = 1,
  ) => ({
    id: randomUUID(),
    produitId,
    articleId,
    quantite,
    tarif: 'DETAIL',
    prixUnitaire,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const tel = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const acc = await prisma.categorie.create({
      data: { commerceId, nom: 'Coques', type: 'ACCESSOIRE' },
    });
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: tel.id,
          nom: 'Tecno Spark 20',
          prixAchat: 1_000_000,
          prixDetail: 1_300_000,
          prixGros: 1_200_000,
        },
      })
    ).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: acc.id,
          nom: 'Coque Spark 20',
          prixAchat: 10_000,
          prixDetail: 30_000,
          prixGros: 25_000,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 20 },
        { produitId: coqueId, boutiqueId: d.boutiqueB.id, quantite: 10 },
      ],
    });
    articles = [];
    for (let i = 0; i < 3; i++) {
      articles.push(
        (
          await prisma.article.create({
            data: {
              commerceId,
              produitId: telephoneId,
              boutiqueId: d.boutiqueA.id,
              imei: imei(),
              prixAchat: 1_000_000,
            },
          })
        ).id,
      );
    }
    client = (
      await prisma.client.create({
        data: {
          commerceId,
          nom: 'Client',
          telephone: `+22462${base.slice(-7)}`,
          typePiece: 'CNI',
          numeroPiece: 'GN-1',
        },
      })
    ).id;
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerantA = await connecter(app, d.gerantA.identifiant);
    vendeurA = await connecter(app, d.vendeurA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);

    // A : un téléphone et 2 coques ; puis un téléphone avec un troc ; B : 3 coques.
    await operation(
      vendeurA,
      d.boutiqueA.id,
      'VENTE_ENREGISTRER',
      vente(
        [ligne(telephoneId, 1_300_000, articles[0]), ligne(coqueId, 30_000, null, 2)],
        1_360_000,
      ),
    );
    trocArticle = randomUUID();
    await operation(
      vendeurA,
      d.boutiqueA.id,
      'VENTE_ENREGISTRER',
      vente([ligne(telephoneId, 1_300_000, articles[1])], 900_000, {
        clientId: client,
        troc: {
          id: randomUUID(),
          articleId: trocArticle,
          produitId: telephoneId,
          imei: imei(),
          etatEcran: 'BON',
          etatBatterie: 'BON',
          etatBoitier: 'BON',
          fonctionne: true,
          note: '',
          valeurProposee: 400_000,
          valeurRetenue: 400_000,
          destination: 'A_REVENDRE',
          prixRevente: 650_000,
          autorisation: null,
        },
      }),
    );
    // Le téléphone repris est revendu.
    await operation(
      vendeurA,
      d.boutiqueA.id,
      'VENTE_ENREGISTRER',
      vente([ligne(telephoneId, 650_000, trocArticle)], 650_000),
    );
    await operation(
      vendeurB,
      d.boutiqueB.id,
      'VENTE_ENREGISTRER',
      vente([ligne(coqueId, 30_000, null, 3)], 90_000),
    );
    // Crédit en retard dans B.
    const venteCredit = await prisma.vente.findFirstOrThrow({
      where: { boutiqueId: d.boutiqueB.id },
    });
    await prisma.credit.create({
      data: {
        commerceId,
        boutiqueId: d.boutiqueB.id,
        venteId: venteCredit.id,
        clientId: client,
        montantTotal: 90_000,
        apport: 0,
        montantFinance: 90_000,
        montantRestant: 90_000,
        nombreTranches: 1,
        frequence: 'MENSUELLE',
        premiereEcheance: new Date('2026-01-10T00:00:00Z'),
        echeances: {
          create: [{ numero: 1, dateEcheance: new Date('2026-01-10T00:00:00Z'), montant: 90_000 }],
        },
      },
    });
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('toutes les boutiques sur un écran, chiffres identiques aux rapports par boutique', async () => {
    const { body } = await http()
      .get('/api/tableau')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const a = body.boutiques.find((b: { boutiqueId: string }) => b.boutiqueId === d.boutiqueA.id);
    const b = body.boutiques.find((x: { boutiqueId: string }) => x.boutiqueId === d.boutiqueB.id);
    expect(a).toMatchObject({
      chiffreAffaires: 3_310_000,
      benefice: 3_310_000 - (1_000_000 + 20_000 + 1_000_000 + 400_000),
      nombreVentes: 3,
      creditsEnRetard: 0,
      derniereSync: expect.any(String),
    });
    expect(b).toMatchObject({
      chiffreAffaires: 90_000,
      nombreVentes: 1,
      creditsEnCours: 1,
      creditsEnRetard: 1,
      creditsEchus: 90_000,
      stockVente: 7 * 30_000,
    });
    // Stock de A : 1 téléphone neuf restant + 18 coques.
    expect(a.stockAchat).toBe(1_000_000 + 18 * 10_000);
    expect(body.total.chiffreAffaires).toBe(3_400_000);
    expect(body.series.length).toBeGreaterThanOrEqual(1);

    for (const boutique of [a, b]) {
      const { body: rapport } = await http()
        .get(`/api/rapports/ventes?boutiqueId=${boutique.boutiqueId}&du=${body.du}&au=${body.au}`)
        .auth(proprietaire.jetonAcces, bearer)
        .expect(200);
      expect(rapport.total).toMatchObject({
        chiffreAffaires: boutique.chiffreAffaires,
        benefice: boutique.benefice,
      });
    }
  });

  it('le gérant ne voit que ses boutiques ; le vendeur n’a pas de tableau', async () => {
    const { body } = await http().get('/api/tableau').auth(gerantA.jetonAcces, bearer).expect(200);
    expect(body.boutiques.map((b: { boutiqueId: string }) => b.boutiqueId)).toEqual([
      d.boutiqueA.id,
    ]);
    await http()
      .get(`/api/tableau?boutiqueId=${d.boutiqueB.id}`)
      .auth(gerantA.jetonAcces, bearer)
      .expect(403);
    await http().get('/api/tableau').auth(vendeurA.jetonAcces, bearer).expect(403);
  });

  it('situation des trocs : repris, revendus et marge', async () => {
    const { body } = await http()
      .get(`/api/tableau/trocs?boutiqueId=${d.boutiqueA.id}`)
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(body.total).toMatchObject({
      repris: 1,
      valeurReprise: 400_000,
      revendus: 1,
      ventesRevendus: 650_000,
      marge: 250_000,
    });
  });

  it('export Excel et rapports planifiés (semaine et mois complets)', async () => {
    const excel = await http()
      .get('/api/tableau/excel')
      .auth(proprietaire.jetonAcces, bearer)
      .buffer(true)
      .expect(200);
    expect(excel.headers['content-type']).toMatch(/spreadsheetml/);

    expect(periodesCompletes('2026-11-04')).toEqual({
      semaine: { du: '2026-10-26', au: '2026-11-02' },
      mois: { du: '2026-10-01', au: '2026-11-01' },
    });
    expect(minuitLocal('2026-11-01', 'Africa/Conakry').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(minuitLocal('2026-11-01', 'Africa/Abidjan').toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );

    const planifies = app.get(RapportsPlanifiesService);
    const maintenant = new Date('2026-11-04T08:00:00Z');
    expect(await planifies.executer(maintenant, [d.commerce.id])).toBe(2);
    expect(await planifies.executer(maintenant, [d.commerce.id])).toBe(0);
    const { body: archives } = await http()
      .get('/api/tableau/archives')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(archives.map((x: { frequence: string }) => x.frequence).sort()).toEqual([
      'MOIS',
      'SEMAINE',
    ]);
    await http()
      .get(`/api/tableau/archives/${archives[0].id}`)
      .auth(proprietaire.jetonAcces, bearer)
      .buffer(true)
      .expect(200);
    await http().get('/api/tableau/archives').auth(gerantA.jetonAcces, bearer).expect(403);
  });
});
