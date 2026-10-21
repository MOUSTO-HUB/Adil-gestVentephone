import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type VenteSaisie } from '@gestvente/commun';
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

/**
 * Critères de recette 1 et 2 du cahier des charges (phase 1) :
 * 1. une vente faite hors ligne apparaît sur le serveur après reconnexion, sans doublon ;
 * 2. un IMEI vendu ne peut plus être vendu, même depuis une autre boutique.
 */
describe('Recette de la phase 1 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let proprietaire: SessionTest;
  let telephoneId: string;
  let article: { id: string; imei: string };
  const base = String(Date.now()).slice(-8);
  let numero = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  const operation = (contenu: VenteSaisie, boutiqueId: string, faiteLe: Date) => ({
    id: randomUUID(),
    type: 'VENTE_ENREGISTRER',
    boutiqueId,
    faiteLe: faiteLe.toISOString(),
    contenu,
  });

  const envoyerLot = async (session: SessionTest, operations: unknown[]) =>
    (
      await http()
        .post('/api/sync/operations')
        .auth(session.jetonAcces, bearer)
        .send({ operations })
        .expect(200)
    ).body.resultats as {
      operationId: string;
      statut: string;
      motif?: string;
      corrections?: { entite: string; id: string; donnees: Record<string, unknown> | null }[];
    }[];

  const venteTelephone = (dateVente: Date, prefixe = 'A'): VenteSaisie => ({
    id: randomUUID(),
    numero: `${prefixe}-${base}-${++numero}`,
    dateVente: dateVente.toISOString(),
    clientId: null,
    lignes: [
      {
        id: randomUUID(),
        produitId: telephoneId,
        articleId: article.id,
        quantite: 1,
        tarif: 'DETAIL',
        prixUnitaire: 1_900_000,
      },
    ],
    remise: 0,
    paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: 1_900_000, reference: null }],
    autorisationRemise: null,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: categorie.id,
          nom: 'Galaxy A25',
          garantieMois: 12,
          prixAchat: 1_500_000,
          prixDetail: 1_900_000,
          prixGros: 1_800_000,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 1 },
        { produitId: telephoneId, boutiqueId: d.boutiqueB.id, quantite: 0 },
      ],
    });
    const a = await prisma.article.create({
      data: {
        commerceId,
        produitId: telephoneId,
        boutiqueId: d.boutiqueA.id,
        imei: completerImei(`39${base}0001`),
        prixAchat: 1_500_000,
      },
    });
    article = { id: a.id, imei: a.imei };
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('1. vente faite hors ligne : sur le serveur à la reconnexion, sans doublon', async () => {
    // Vente enregistrée sur l'appareil il y a 3 heures, sans réseau.
    const ilYa3h = new Date(Date.now() - 3 * 3_600_000);
    const contenu = venteTelephone(ilYa3h);
    const lot = [operation(contenu, d.boutiqueA.id, ilYa3h)];
    const curseur = Number(
      (await http().get('/api/sync/instantane').auth(gerant.jetonAcces, bearer)).body.curseur,
    );

    // Reconnexion : le lot est envoyé ; la réponse se perd, l'appareil le renvoie.
    const premier = await envoyerLot(vendeur, lot);
    const second = await envoyerLot(vendeur, lot);
    expect(premier[0]?.statut).toBe('APPLIQUEE');
    expect(second).toEqual(premier);

    // Une seule vente, à sa date hors ligne ; le stock n'a baissé qu'une fois.
    const ventes = await prisma.vente.findMany({ where: { numero: contenu.numero } });
    expect(ventes).toHaveLength(1);
    expect(ventes[0]?.dateVente.toISOString()).toBe(ilYa3h.toISOString());
    expect(
      (
        await prisma.stock.findFirstOrThrow({
          where: { produitId: telephoneId, boutiqueId: d.boutiqueA.id },
        })
      ).quantite,
    ).toBe(0);
    expect(await prisma.operationSync.count({ where: { id: lot[0]!.id } })).toBe(1);

    // Les autres appareils de la boutique la reçoivent une seule fois.
    const { body } = await http()
      .get('/api/sync/changements')
      .query({ curseur })
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    const recues = (body.changements as { entite: string; id: string }[]).filter(
      (c) => c.entite === 'vente' && c.id === contenu.id,
    );
    expect(recues).toHaveLength(1);
  });

  it('2. un IMEI vendu ne peut plus être vendu, même depuis une autre boutique', async () => {
    expect((await prisma.article.findUniqueOrThrow({ where: { id: article.id } })).statut).toBe(
      'VENDU',
    );
    // Même boutique, autre appareil resté hors ligne : conflit, la vente est effacée sur l'appareil.
    const memeBoutique = venteTelephone(new Date());
    const [conflit] = await envoyerLot(gerant, [
      operation(memeBoutique, d.boutiqueA.id, new Date()),
    ]);
    expect(conflit).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/vendu/) });
    expect(conflit?.corrections).toEqual(
      expect.arrayContaining([{ seq: 0, entite: 'vente', id: memeBoutique.id, donnees: null }]),
    );

    // Autre boutique (le propriétaire y a accès) : refusé aussi.
    const autreBoutique = venteTelephone(new Date(), 'B');
    const [refus] = await envoyerLot(proprietaire, [
      operation(autreBoutique, d.boutiqueB.id, new Date()),
    ]);
    expect(['CONFLIT', 'REJETEE']).toContain(refus?.statut);
    expect(refus?.motif).toMatch(/IMEI/);

    expect(
      await prisma.vente.count({ where: { id: { in: [memeBoutique.id, autreBoutique.id] } } }),
    ).toBe(0);
    expect(await prisma.ligneVente.count({ where: { articleId: article.id } })).toBe(1);
  });
});
