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

/**
 * IMEI facultatif : téléphones reçus en quantité, vendus sans IMEI tant qu'il en reste
 * sans IMEI ; paiement fournisseur avec mode et référence ; correction du prix d'un bon reçu.
 */
describe('Téléphones sans IMEI et paiements fournisseur (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let gerant: SessionTest;
  let telephoneId: string;
  let fournisseurId: string;
  const achatId = randomUUID();
  const ligneTel = randomUUID();
  const base = String(Date.now()).slice(-8);
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  const envoyer = async (type: string, contenu: unknown) =>
    (
      (
        await http()
          .post('/api/sync/operations')
          .auth(gerant.jetonAcces, bearer)
          .send({
            operations: [
              {
                id: randomUUID(),
                type,
                boutiqueId: d.boutiqueA.id,
                faiteLe: new Date().toISOString(),
                contenu,
              },
            ],
          })
          .expect(200)
      ).body.resultats as ResultatOp[]
    )[0];

  const stock = async () =>
    (
      await prisma.stock.findFirst({
        where: { produitId: telephoneId, boutiqueId: d.boutiqueA.id },
      })
    )?.quantite ?? 0;

  const vendre = (articleId: string | null, quantite = 1) =>
    envoyer('VENTE_ENREGISTRER', {
      id: randomUUID(),
      numero: `SI-${base}-${randomUUID().slice(0, 4)}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: randomUUID(),
          produitId: telephoneId,
          articleId,
          quantite,
          tarif: 'DETAIL',
          prixUnitaire: 900_000,
        },
      ],
      remise: 0,
      paiements: [
        { id: randomUUID(), moyen: 'ESPECES', montant: 900_000 * quantite, reference: null },
      ],
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
          nom: 'Itel A70',
          prixAchat: 700_000,
          prixDetail: 900_000,
          prixGros: 850_000,
        },
      })
    ).id;
    fournisseurId = (await prisma.fournisseur.create({ data: { commerceId, nom: 'Grossiste' } }))
      .id;
    gerant = await connecter(app, d.gerantA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('réception de téléphones en quantité, un seul IMEI saisi sur trois', async () => {
    expect(
      (
        await envoyer('ACHAT_ENREGISTRER', {
          id: achatId,
          fournisseurId,
          numero: `SI-${base}`,
          dateAchat: '2026-11-24',
          note: null,
          lignes: [{ id: ligneTel, produitId: telephoneId, quantite: 3, prixAchat: 700_000 }],
        })
      ).statut,
    ).toBe('APPLIQUEE');
    // Plus d'IMEI que de téléphones reçus : refusé.
    const trop = await envoyer('ACHAT_RECEVOIR', {
      achatId,
      lignes: [
        {
          ligneId: ligneTel,
          quantite: 1,
          articles: [1, 2].map((n) => ({
            id: randomUUID(),
            imei: completerImei(`86${base}${String(n).padStart(4, '0')}`),
          })),
        },
      ],
    });
    expect(trop.statut).not.toBe('APPLIQUEE');
    const r = await envoyer('ACHAT_RECEVOIR', {
      achatId,
      lignes: [
        {
          ligneId: ligneTel,
          quantite: 3,
          articles: [{ id: randomUUID(), imei: completerImei(`86${base}0001`) }],
        },
      ],
    });
    expect(r.statut).toBe('APPLIQUEE');
    expect(await stock()).toBe(3);
    expect(await prisma.article.count({ where: { produitId: telephoneId } })).toBe(1);
    expect((await prisma.achat.findUniqueOrThrow({ where: { id: achatId } })).statut).toBe('RECU');
  });

  it('paiement au fournisseur : mode et référence gardés sur le bon', async () => {
    const r = await envoyer('ACHAT_PAYER', {
      achatId,
      montant: 500_000,
      moyen: 'ORANGE_MONEY',
      reference: ' OM-12345 ',
    });
    expect(r.statut).toBe('APPLIQUEE');
    const achat = await prisma.achat.findUniqueOrThrow({ where: { id: achatId } });
    expect(Number(achat.montantPaye)).toBe(500_000);
    expect(achat.paiements).toEqual([
      expect.objectContaining({ montant: 500_000, moyen: 'ORANGE_MONEY', reference: 'OM-12345' }),
    ]);
  });

  it('vente sans IMEI tant qu’il en reste sans IMEI, puis IMEI exigé', async () => {
    expect((await vendre(null, 2)).statut).toBe('APPLIQUEE');
    expect(await stock()).toBe(1);
    // Ne reste que le téléphone enregistré avec son IMEI : il faut le choisir.
    const refus = await vendre(null);
    expect(refus.statut).toBe('CONFLIT');
    expect(refus.motif).toMatch(/choisissez l’IMEI/);
    const article = await prisma.article.findFirstOrThrow({ where: { produitId: telephoneId } });
    expect((await vendre(article.id)).statut).toBe('APPLIQUEE');
    expect(await stock()).toBe(0);
  });

  it('correction du prix d’un bon reçu : les téléphones reçus prennent le nouveau coût', async () => {
    const r = await envoyer('ACHAT_ENREGISTRER', {
      id: achatId,
      fournisseurId,
      numero: `SI-${base}`,
      dateAchat: '2026-11-24',
      note: 'Prix corrigé',
      lignes: [{ id: ligneTel, produitId: telephoneId, quantite: 3, prixAchat: 680_000 }],
    });
    expect(r.statut).toBe('APPLIQUEE');
    const article = await prisma.article.findFirstOrThrow({ where: { produitId: telephoneId } });
    expect(Number(article.prixAchat)).toBe(680_000);
    const achat = await prisma.achat.findUniqueOrThrow({ where: { id: achatId } });
    expect(Number(achat.montantTotal)).toBe(2_040_000);
    expect(achat.statut).toBe('RECU');
  });
});
