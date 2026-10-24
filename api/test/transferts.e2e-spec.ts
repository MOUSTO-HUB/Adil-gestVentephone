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
  statut: string;
  motif?: string;
}

describe('Transferts entre boutiques (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerantA: SessionTest;
  let vendeurA: SessionTest;
  let vendeurB: SessionTest;
  let telephoneId: string;
  let coqueId: string;
  let articles: { id: string; imei: string }[];
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);
  let n = 0;
  const numero = () => `TR-${base}-${++n}`;

  const envoyer = async (s: SessionTest, boutiqueId: string, type: string, contenu: unknown) =>
    (
      (
        await http()
          .post('/api/sync/operations')
          .auth(s.jetonAcces, bearer)
          .send({
            operations: [
              { id: randomUUID(), type, boutiqueId, faiteLe: new Date().toISOString(), contenu },
            ],
          })
          .expect(200)
      ).body.resultats as ResultatOp[]
    )[0];
  const stock = async (produitId: string, boutiqueId: string) =>
    (await prisma.stock.findUnique({ where: { produitId_boutiqueId: { produitId, boutiqueId } } }))
      ?.quantite ?? 0;

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
          nom: 'Itel A70',
          prixAchat: 700_000,
          prixDetail: 850_000,
          prixGros: 800_000,
        },
      })
    ).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: acc.id,
          nom: 'Coque Itel A70',
          prixAchat: 10_000,
          prixDetail: 25_000,
          prixGros: 20_000,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 20 },
      ],
    });
    articles = [];
    for (let i = 1; i <= 3; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: telephoneId,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`89${base}000${i}`),
          prixAchat: 700_000,
        },
      });
      articles.push({ id: a.id, imei: a.imei });
    }
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerantA = await connecter(app, d.gerantA.identifiant);
    vendeurA = await connecter(app, d.vendeurA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  const demandeId = randomUUID();
  const lignesEnvoi = () => [
    { id: randomUUID(), produitId: telephoneId, articleId: articles[0].id, quantite: 1 },
    { id: randomUUID(), produitId: telephoneId, articleId: articles[1].id, quantite: 1 },
    { id: randomUUID(), produitId: coqueId, articleId: null, quantite: 10 },
  ];
  let envoi: ReturnType<typeof lignesEnvoi>;

  it('la boutique qui reçoit demande ; les deux boutiques la voient', async () => {
    const demande = {
      id: demandeId,
      numero: numero(),
      boutiqueDepartId: d.boutiqueA.id,
      lignes: [
        { id: randomUUID(), produitId: telephoneId, quantite: 2 },
        { id: randomUUID(), produitId: coqueId, quantite: 10 },
      ],
      note: 'Rupture à B',
    };
    expect((await envoyer(vendeurB, d.boutiqueB.id, 'TRANSFERT_DEMANDER', demande)).statut).toBe(
      'REJETEE',
    );
    expect(
      (await envoyer(proprietaire, d.boutiqueB.id, 'TRANSFERT_DEMANDER', demande)).statut,
    ).toBe('APPLIQUEE');
    for (const s of [gerantA, vendeurB]) {
      const { body } = await http()
        .get('/api/sync/instantane')
        .auth(s.jetonAcces, bearer)
        .expect(200);
      expect(body.donnees.transfert.find((t: { id: string }) => t.id === demandeId)).toMatchObject({
        statut: 'DEMANDE',
      });
    }
    // Le vendeur A (sans gestion) voit aussi la demande : sa boutique est le départ.
    expect(await stock(coqueId, d.boutiqueB.id)).toBe(0);
  });

  it('envoi par scan : téléphones EN_TRANSFERT, stock de départ diminué, arrivée inchangée', async () => {
    expect(
      (
        await envoyer(gerantA, d.boutiqueA.id, 'TRANSFERT_ENVOYER', {
          id: randomUUID(),
          numero: numero(),
          boutiqueArriveeId: d.boutiqueB.id,
          lignes: lignesEnvoi(),
          note: null,
        })
      ).motif,
    ).toMatch(/propriétaire/);
    envoi = lignesEnvoi();
    expect(
      await envoyer(gerantA, d.boutiqueA.id, 'TRANSFERT_ENVOYER', {
        id: demandeId,
        numero: 'ignoré',
        boutiqueArriveeId: d.boutiqueB.id,
        lignes: envoi,
        note: null,
      }),
    ).toMatchObject({ statut: 'APPLIQUEE' });
    expect((await prisma.transfert.findUniqueOrThrow({ where: { id: demandeId } })).statut).toBe(
      'ENVOYE',
    );
    expect(await prisma.ligneTransfert.count({ where: { transfertId: demandeId } })).toBe(3);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articles[0].id } })).statut).toBe(
      'EN_TRANSFERT',
    );
    expect(await stock(telephoneId, d.boutiqueA.id)).toBe(1);
    expect(await stock(coqueId, d.boutiqueA.id)).toBe(10);
    expect(await stock(coqueId, d.boutiqueB.id)).toBe(0);

    // Un téléphone en route ne se vend pas.
    const vente = await envoyer(vendeurA, d.boutiqueA.id, 'VENTE_ENREGISTRER', {
      id: randomUUID(),
      numero: `V-${base}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: randomUUID(),
          produitId: telephoneId,
          articleId: articles[0].id,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 850_000,
        },
      ],
      remise: 0,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: 850_000, reference: null }],
      autorisationRemise: null,
    });
    expect(vente).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/transfert/) });
  });

  it('réception par scan : seul le reçu entre en stock, écarts signalés', async () => {
    const reception = {
      transfertId: demandeId,
      recuLe: new Date().toISOString(),
      quantites: [{ ligneId: envoi[2].id, quantite: 8 }],
      articlesRecus: [articles[0].id],
      note: '2 coques et un Itel manquent',
    };
    expect((await envoyer(vendeurA, d.boutiqueA.id, 'TRANSFERT_RECEVOIR', reception)).statut).toBe(
      'REJETEE',
    );
    expect((await envoyer(vendeurB, d.boutiqueB.id, 'TRANSFERT_RECEVOIR', reception)).statut).toBe(
      'APPLIQUEE',
    );
    expect(await stock(telephoneId, d.boutiqueB.id)).toBe(1);
    expect(await stock(coqueId, d.boutiqueB.id)).toBe(8);
    expect(await prisma.article.findUniqueOrThrow({ where: { id: articles[0].id } })).toMatchObject(
      { statut: 'EN_STOCK', boutiqueId: d.boutiqueB.id },
    );
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articles[1].id } })).statut).toBe(
      'EN_TRANSFERT',
    );
    expect(
      await prisma.journalAudit.count({
        where: { commerceId: d.commerce.id, action: 'TRANSFERT_ECART' },
      }),
    ).toBe(1);
    expect((await envoyer(vendeurB, d.boutiqueB.id, 'TRANSFERT_RECEVOIR', reception)).statut).toBe(
      'CONFLIT',
    );

    // Les appareils de B reçoivent le téléphone ; ceux de A ne l'ont plus.
    const b = await http()
      .get('/api/sync/instantane')
      .auth(vendeurB.jetonAcces, bearer)
      .expect(200);
    expect(b.body.donnees.article.some((a: { id: string }) => a.id === articles[0].id)).toBe(true);
    const lignes = b.body.donnees.ligneTransfert.filter(
      (l: { transfertId: string }) => l.transfertId === demandeId,
    );
    expect(lignes.find((l: { articleId: string }) => l.articleId === articles[1].id)).toMatchObject(
      {
        imei: articles[1].imei,
        quantiteRecue: 0,
      },
    );
  });

  it('historique dans la fiche IMEI', async () => {
    const { body } = await http()
      .get(`/api/articles/imei/${articles[0].imei}`)
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const types = body.evenements.map(
      (e: { type: string; detail: string }) => `${e.type} ${e.detail}`,
    );
    expect(types).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^TRANSFERT_SORTIE TR-.* vers Boutique B$/),
        expect.stringMatching(/^TRANSFERT_ENTREE TR-.* depuis Boutique A$/),
      ]),
    );
  });

  it('envoi direct du propriétaire, puis annulation : le stock revient', async () => {
    const id = randomUUID();
    expect(
      (
        await envoyer(proprietaire, d.boutiqueA.id, 'TRANSFERT_ENVOYER', {
          id,
          numero: numero(),
          boutiqueArriveeId: d.boutiqueB.id,
          lignes: [
            { id: randomUUID(), produitId: telephoneId, articleId: articles[2].id, quantite: 1 },
            { id: randomUUID(), produitId: coqueId, articleId: null, quantite: 5 },
          ],
          note: null,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    expect(await stock(coqueId, d.boutiqueA.id)).toBe(5);
    expect(
      (
        await envoyer(gerantA, d.boutiqueA.id, 'TRANSFERT_ENVOYER', {
          id: randomUUID(),
          numero: numero(),
          boutiqueArriveeId: d.boutiqueB.id,
          lignes: [{ id: randomUUID(), produitId: coqueId, articleId: null, quantite: 6 }],
          note: null,
        })
      ).statut,
    ).toBe('REJETEE');
    // L'arrivée ne peut pas annuler un envoi parti ; le départ si.
    expect(
      (
        await envoyer(proprietaire, d.boutiqueB.id, 'TRANSFERT_ANNULER', {
          transfertId: id,
          motif: 'Erreur',
        })
      ).statut,
    ).toBe('REJETEE');
    expect(
      (
        await envoyer(gerantA, d.boutiqueA.id, 'TRANSFERT_ANNULER', {
          transfertId: id,
          motif: 'Erreur',
        })
      ).statut,
    ).toBe('APPLIQUEE');
    expect(await stock(coqueId, d.boutiqueA.id)).toBe(10);
    expect(await prisma.article.findUniqueOrThrow({ where: { id: articles[2].id } })).toMatchObject(
      { statut: 'EN_STOCK', boutiqueId: d.boutiqueA.id },
    );
  });
});
