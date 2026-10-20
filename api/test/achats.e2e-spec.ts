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
  corrections?: { entite: string; id: string; donnees: Record<string, unknown> | null }[];
}

describe('Achats, stock et inventaire (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  let telephoneId: string;
  let coqueId: string;
  let fournisseurId: string;
  const achatId = randomUUID();
  const ligneTel = randomUUID();
  const ligneCoque = randomUUID();
  const base = String(Date.now()).slice(-8);
  const imei = (n: number) => completerImei(`35${base}${String(n).padStart(4, '0')}`);

  const envoyer = async (session: SessionTest, type: string, contenu: unknown) =>
    (
      (
        await http()
          .post('/api/sync/operations')
          .auth(session.jetonAcces, bearer)
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

  const achat = (quantiteTel = 3) => ({
    id: achatId,
    fournisseurId,
    numero: `TEST-${base}`,
    dateAchat: '2026-10-20',
    note: null,
    lignes: [
      { id: ligneTel, produitId: telephoneId, quantite: quantiteTel, prixAchat: 1_000_000 },
      { id: ligneCoque, produitId: coqueId, quantite: 10, prixAchat: 15_000 },
    ],
  });

  const quantite = async (produitId: string) =>
    (await prisma.stock.findFirst({ where: { produitId, boutiqueId: d.boutiqueA.id } }))
      ?.quantite ?? 0;

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const catTel = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const catAcc = await prisma.categorie.create({
      data: { commerceId, nom: 'Coques', type: 'ACCESSOIRE' },
    });
    const prix = { prixAchat: 1_000_000, prixDetail: 1_300_000, prixGros: 1_200_000 };
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: catTel.id,
          nom: 'Tecno Spark 20',
          ...prix,
        },
      })
    ).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: catAcc.id,
          nom: 'Coque Spark 20',
          prixAchat: 15_000,
          prixDetail: 30_000,
          prixGros: 25_000,
        },
      })
    ).id;
    fournisseurId = (
      await prisma.fournisseur.create({ data: { commerceId, nom: 'Madina Télécom' } })
    ).id;
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  describe('bon d’achat', () => {
    it('le gérant crée un brouillon ; total calculé, dette du fournisseur à jour', async () => {
      expect((await envoyer(vendeur, 'ACHAT_ENREGISTRER', achat())).motif).toMatch(/rôle/);
      expect((await envoyer(gerant, 'ACHAT_ENREGISTRER', achat())).statut).toBe('APPLIQUEE');
      const enBase = await prisma.achat.findUniqueOrThrow({ where: { id: achatId } });
      expect(enBase).toMatchObject({
        statut: 'BROUILLON',
        montantTotal: 3_150_000n,
        boutiqueId: d.boutiqueA.id,
      });

      const { body } = await http().get('/api/sync/instantane').auth(gerant.jetonAcces, bearer);
      expect(body.donnees.achat).toEqual([
        expect.objectContaining({ id: achatId, montantTotal: 3_150_000, dateAchat: '2026-10-20' }),
      ]);
      expect(body.donnees.ligneAchat).toHaveLength(2);
      expect(body.donnees.fournisseur[0]).toMatchObject({ dette: 3_150_000 });
      const { body: vue } = await http()
        .get('/api/sync/instantane')
        .auth(vendeur.jetonAcces, bearer);
      expect(vue.donnees.achat).toEqual([]);
    });

    it('un brouillon se modifie ; numéro en double refusé', async () => {
      expect((await envoyer(gerant, 'ACHAT_ENREGISTRER', achat(4))).statut).toBe('APPLIQUEE');
      expect((await prisma.achat.findUniqueOrThrow({ where: { id: achatId } })).montantTotal).toBe(
        4_150_000n,
      );
      const doublon = await envoyer(gerant, 'ACHAT_ENREGISTRER', {
        ...achat(),
        id: randomUUID(),
        lignes: achat().lignes.map((l) => ({ ...l, id: randomUUID() })),
      });
      expect(doublon.motif).toMatch(/déjà utilisé/);
    });
  });

  describe('réception', () => {
    it('réception partielle : téléphones par IMEI, accessoires par quantité, mouvements', async () => {
      const articles = [1, 2].map((n) => ({ id: randomUUID(), imei: imei(n) }));
      const r = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [
          { ligneId: ligneTel, articles },
          { ligneId: ligneCoque, quantite: 4 },
        ],
      });
      expect(r.statut).toBe('APPLIQUEE');
      expect((await prisma.achat.findUniqueOrThrow({ where: { id: achatId } })).statut).toBe(
        'PARTIEL',
      );
      expect(
        await prisma.article.findUniqueOrThrow({ where: { id: articles[0].id } }),
      ).toMatchObject({
        imei: imei(1),
        statut: 'EN_STOCK',
        prixAchat: 1_000_000n,
        ligneAchatId: ligneTel,
      });
      expect(await quantite(telephoneId)).toBe(2);
      expect(await quantite(coqueId)).toBe(4);
      expect(
        await prisma.mouvementStock.count({ where: { referenceId: achatId, type: 'ACHAT' } }),
      ).toBe(3);
    });

    it('refuse un IMEI invalide ou saisi deux fois ; conflit pour un IMEI déjà connu', async () => {
      const invalide = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [{ ligneId: ligneTel, articles: [{ id: randomUUID(), imei: '123456789012345' }] }],
      });
      expect(invalide).toMatchObject({
        statut: 'REJETEE',
        motif: expect.stringMatching(/invalide/),
      });

      const double = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [
          {
            ligneId: ligneTel,
            articles: [
              { id: randomUUID(), imei: imei(3) },
              { id: randomUUID(), imei: imei(3) },
            ],
          },
        ],
      });
      expect(double.motif).toMatch(/deux fois/);

      const refuse = randomUUID();
      const connu = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [{ ligneId: ligneTel, articles: [{ id: refuse, imei: imei(1) }] }],
      });
      expect(connu).toMatchObject({
        statut: 'CONFLIT',
        motif: expect.stringMatching(/déjà enregistré/),
      });
      // L'appareil efface le téléphone qu'il avait ajouté et reprend les quantités du serveur.
      expect(connu.corrections).toEqual(
        expect.arrayContaining([
          { seq: 0, entite: 'article', id: refuse, donnees: null },
          expect.objectContaining({
            entite: 'stock',
            donnees: expect.objectContaining({ produitId: telephoneId, quantite: 2 }),
          }),
        ]),
      );
    });

    it('refuse de recevoir plus que commandé ou de modifier un bon déjà reçu', async () => {
      const trop = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [{ ligneId: ligneCoque, quantite: 7 }],
      });
      expect(trop).toMatchObject({
        statut: 'CONFLIT',
        motif: expect.stringMatching(/7 reçu\(s\) pour 6/),
      });
      expect((await envoyer(gerant, 'ACHAT_ENREGISTRER', achat())).statut).toBe('CONFLIT');
    });

    it('réception du reste : bon reçu en totalité', async () => {
      const r = await envoyer(gerant, 'ACHAT_RECEVOIR', {
        achatId,
        lignes: [
          { ligneId: ligneTel, articles: [3, 4].map((n) => ({ id: randomUUID(), imei: imei(n) })) },
          { ligneId: ligneCoque, quantite: 6 },
        ],
      });
      expect(r.statut).toBe('APPLIQUEE');
      expect((await prisma.achat.findUniqueOrThrow({ where: { id: achatId } })).statut).toBe(
        'RECU',
      );
      expect(await quantite(telephoneId)).toBe(4);
      expect(await quantite(coqueId)).toBe(10);
    });
  });

  describe('paiements et annulation', () => {
    it('paiement partiel, puis refus au-delà du reste dû', async () => {
      expect((await envoyer(gerant, 'ACHAT_PAYER', { achatId, montant: 1_000_000 })).statut).toBe(
        'APPLIQUEE',
      );
      const { body } = await http()
        .get(`/api/fournisseurs/${fournisseurId}/achats`)
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(body.dette).toBe(3_150_000);
      expect((await envoyer(gerant, 'ACHAT_PAYER', { achatId, montant: 3_150_001 })).motif).toMatch(
        /dépasse/,
      );
    });

    it('un bon reçu ne s’annule pas ; un brouillon si', async () => {
      expect((await envoyer(gerant, 'ACHAT_ANNULER', { achatId })).statut).toBe('CONFLIT');
      const brouillon = randomUUID();
      await envoyer(gerant, 'ACHAT_ENREGISTRER', {
        id: brouillon,
        fournisseurId,
        numero: `TEST2-${base}`,
        dateAchat: '2026-10-21',
        note: 'À annuler',
        lignes: [{ id: randomUUID(), produitId: coqueId, quantite: 5, prixAchat: 15_000 }],
      });
      expect((await envoyer(gerant, 'ACHAT_ANNULER', { achatId: brouillon })).statut).toBe(
        'APPLIQUEE',
      );
      const { body } = await http()
        .get(`/api/fournisseurs/${fournisseurId}/achats`)
        .auth(gerant.jetonAcces, bearer);
      // Le bon annulé ne compte plus dans la dette.
      expect(body.dette).toBe(3_150_000);
    });
  });

  describe('seuil et inventaire', () => {
    it('fixe le seuil d’alerte du stock', async () => {
      expect(
        (await envoyer(gerant, 'STOCK_SEUIL', { produitId: coqueId, seuilMinimum: 3 })).statut,
      ).toBe('APPLIQUEE');
      expect(
        (await prisma.stock.findFirstOrThrow({ where: { produitId: coqueId } })).seuilMinimum,
      ).toBe(3);
    });

    it('inventaire : manque d’accessoires, téléphone manquant, IMEI hors stock', async () => {
      const inventaireId = randomUUID();
      const r = await envoyer(gerant, 'INVENTAIRE_VALIDER', {
        id: inventaireId,
        motif: 'Inventaire de fin de mois',
        lignes: [
          { produitId: coqueId, quantiteComptee: 8 },
          { produitId: telephoneId, imeis: [imei(1), imei(2), imei(3), imei(99)] },
        ],
      });
      expect(r.statut).toBe('APPLIQUEE');
      expect(await quantite(coqueId)).toBe(8);
      expect(await quantite(telephoneId)).toBe(3);
      const manquant = await prisma.article.findFirstOrThrow({ where: { imei: imei(4) } });
      expect(manquant.statut).toBe('REBUT');
      expect(
        await prisma.mouvementStock.findFirst({
          where: { referenceId: inventaireId, produitId: coqueId },
        }),
      ).toMatchObject({
        type: 'AJUSTEMENT',
        quantite: -2,
      });
      const lignes = await prisma.ligneInventaire.findMany({ where: { inventaireId } });
      expect(lignes.find((l) => l.motifEcart?.includes('hors stock'))?.motifEcart).toContain(
        imei(99),
      );
      const journal = await prisma.journalAudit.findFirst({
        where: { action: 'INVENTAIRE_VALIDE', entiteId: inventaireId },
      });
      expect(journal?.details).toMatchObject({ motif: 'Inventaire de fin de mois' });
    });

    it('refuse un téléphone compté en quantité et un vendeur', async () => {
      const r = await envoyer(gerant, 'INVENTAIRE_VALIDER', {
        id: randomUUID(),
        motif: 'Comptage',
        lignes: [{ produitId: telephoneId, quantiteComptee: 3 }],
      });
      expect(r.motif).toMatch(/IMEI/);
      expect(
        (
          await envoyer(vendeur, 'INVENTAIRE_VALIDER', {
            id: randomUUID(),
            motif: 'Comptage',
            lignes: [{ produitId: coqueId, quantiteComptee: 1 }],
          })
        ).motif,
      ).toMatch(/rôle/);
    });
  });

  describe('fiche IMEI', () => {
    it('historique complet ; fournisseur et prix d’achat réservés à la gestion', async () => {
      const { body } = await http()
        .get(`/api/articles/imei/${imei(4)}`)
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(body).toMatchObject({
        imei: imei(4),
        produit: 'Tecno Spark 20',
        statut: 'REBUT',
        prixAchat: 1_000_000,
      });
      expect(body.evenements.map((e: { type: string }) => e.type)).toEqual(['ACHAT', 'REBUT']);
      expect(body.evenements[0].detail).toContain('Madina Télécom');
      expect(body.evenements[1].detail).toContain('manquant');

      const { body: vue } = await http()
        .get(`/api/articles/imei/${imei(4).slice(0, 5)} ${imei(4).slice(5)}`)
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);
      expect(vue.prixAchat).toBeNull();
      expect(vue.evenements[0].detail).not.toContain('Madina');
      await http()
        .get(`/api/articles/imei/${imei(98)}`)
        .auth(gerant.jetonAcces, bearer)
        .expect(404);
    });
  });
});
