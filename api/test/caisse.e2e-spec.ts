import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { VenteSaisie } from '@gestvente/commun';
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

describe('Caisse et dépenses (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let coqueId: string;
  const caisseId = randomUUID();
  let numero = 0;
  const base = String(Date.now()).slice(-8);
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

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

  const vente = (
    quantite: number,
    paiements: VenteSaisie['paiements'],
    caisse: string | null = caisseId,
  ): VenteSaisie => ({
    id: randomUUID(),
    numero: `CAI-${base}-${++numero}`,
    dateVente: new Date().toISOString(),
    clientId: null,
    lignes: [
      {
        id: randomUUID(),
        produitId: coqueId,
        articleId: null,
        quantite,
        tarif: 'DETAIL',
        prixUnitaire: 35_000,
      },
    ],
    remise: 0,
    paiements,
    autorisationRemise: null,
    caisseId: caisse,
  });
  const especes = (montant: number) => ({
    id: randomUUID(),
    moyen: 'ESPECES' as const,
    montant,
    reference: null,
  });
  const depense = (surcharge: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    dateDepense: new Date().toISOString(),
    categorie: 'TRANSPORT',
    libelle: 'Taxi pour la livraison',
    montant: 10_000,
    moyen: 'ESPECES',
    caisseId,
    ...surcharge,
  });
  const comptage = (ESPECES: number, ORANGE_MONEY = 70_000) => ({
    ESPECES,
    ORANGE_MONEY,
    MTN_MOMO: 0,
    VIREMENT: 0,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const categorie = await prisma.categorie.create({
      data: { commerceId: d.commerce.id, nom: 'Coques', type: 'ACCESSOIRE' },
    });
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId: d.commerce.id,
          type: 'ACCESSOIRE',
          categorieId: categorie.id,
          nom: 'Coque',
          prixAchat: 15_000,
          prixDetail: 35_000,
          prixGros: 27_000,
        },
      })
    ).id;
    await prisma.stock.create({
      data: { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 100 },
    });
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('ouverture : une seule caisse ouverte par vendeur et boutique', async () => {
    const ouverture = { id: caisseId, ouverteLe: new Date().toISOString(), fondInitial: 100_000 };
    expect(await envoyer(vendeur, 'CAISSE_OUVRIR', ouverture)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    const seconde = await envoyer(vendeur, 'CAISSE_OUVRIR', {
      ...ouverture,
      id: randomUUID(),
    });
    expect(seconde).toMatchObject({
      statut: 'CONFLIT',
      motif: expect.stringMatching(/déjà une caisse/),
    });
    expect(seconde.corrections).toEqual([
      expect.objectContaining({ entite: 'caisse', donnees: null }),
    ]);
    // La caisse d'un autre utilisateur ne reçoit pas ses ventes.
    const venteGerant = vente(1, [especes(35_000)]);
    expect((await envoyer(gerant, 'VENTE_ENREGISTRER', venteGerant)).statut).toBe('APPLIQUEE');
    expect(
      (await prisma.vente.findUniqueOrThrow({ where: { id: venteGerant.id } })).caisseId,
    ).toBeNull();
  });

  it('ventes et dépenses rattachées ; un vendeur paie une dépense depuis sa caisse', async () => {
    // 35 000 payés 50 000 en espèces (15 000 rendus) ; 70 000 par Orange Money.
    const enEspeces = vente(1, [especes(50_000)]);
    const parOm = vente(2, [
      { id: randomUUID(), moyen: 'ORANGE_MONEY', montant: 70_000, reference: 'OM-1' },
    ]);
    for (const v of [enEspeces, parOm]) {
      expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', v)).statut).toBe('APPLIQUEE');
    }
    expect(await prisma.vente.count({ where: { caisseId } })).toBe(2);

    expect((await envoyer(vendeur, 'DEPENSE_ENREGISTRER', depense())).statut).toBe('APPLIQUEE');
    expect(
      (await envoyer(vendeur, 'DEPENSE_ENREGISTRER', depense({ caisseId: null }))).motif,
    ).toMatch(/depuis sa caisse/);
    // Le propriétaire ou le gérant paie un loyer hors caisse.
    expect(
      (
        await envoyer(
          gerant,
          'DEPENSE_ENREGISTRER',
          depense({
            caisseId: null,
            categorie: 'LOYER',
            libelle: 'Loyer d’octobre',
            montant: 2_000_000,
          }),
        )
      ).statut,
    ).toBe('APPLIQUEE');
  });

  it('clôture : attendu recalculé par le serveur, écart expliqué', async () => {
    // Attendu en espèces : 100 000 + 35 000 − 10 000 = 125 000 ; Orange Money : 70 000.
    const sansCommentaire = await envoyer(vendeur, 'CAISSE_CLOTURER', {
      caisseId,
      clotureeLe: new Date().toISOString(),
      comptage: comptage(120_000),
      commentaire: null,
    });
    expect(sansCommentaire.motif).toMatch(/expliquez-le/);
    expect(
      (
        await envoyer(vendeur, 'CAISSE_CLOTURER', {
          caisseId,
          clotureeLe: new Date().toISOString(),
          comptage: comptage(120_000),
          commentaire: 'Billet de 5 000 introuvable',
        })
      ).statut,
    ).toBe('APPLIQUEE');
    expect(await prisma.caisse.findUniqueOrThrow({ where: { id: caisseId } })).toMatchObject({
      statut: 'CLOTUREE',
      ecart: -5_000n,
      theorique: { ESPECES: 125_000, ORANGE_MONEY: 70_000, MTN_MOMO: 0, VIREMENT: 0 },
    });
    // Après la clôture, plus rien n'est rattaché à cette caisse.
    const tardive = vente(1, [especes(35_000)]);
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', tardive)).statut).toBe('APPLIQUEE');
    expect(
      (await prisma.vente.findUniqueOrThrow({ where: { id: tardive.id } })).caisseId,
    ).toBeNull();
    expect((await envoyer(vendeur, 'DEPENSE_ENREGISTRER', depense())).statut).toBe('CONFLIT');
  });

  it('validation par le gérant seulement ; la caisse descend sur les appareils', async () => {
    expect((await envoyer(vendeur, 'CAISSE_VALIDER', { caisseId, commentaire: null })).statut).toBe(
      'REJETEE',
    );
    expect(
      (await envoyer(gerant, 'CAISSE_VALIDER', { caisseId, commentaire: 'Écart retenu' })).statut,
    ).toBe('APPLIQUEE');
    expect(await prisma.caisse.findUniqueOrThrow({ where: { id: caisseId } })).toMatchObject({
      statut: 'VALIDEE',
      valideParId: d.gerantA.id,
    });
    const { body } = await http().get('/api/sync/instantane').auth(vendeur.jetonAcces, bearer);
    expect(body.donnees.caisse).toEqual([
      expect.objectContaining({
        id: caisseId,
        statut: 'VALIDEE',
        vendeur: d.vendeurA.nom,
        ecart: -5_000,
      }),
    ]);
    expect(body.donnees.depense).toHaveLength(2);
    expect(
      await prisma.journalAudit.count({
        where: {
          entiteId: caisseId,
          action: { in: ['CAISSE_OUVERTE', 'CAISSE_CLOTUREE', 'CAISSE_VALIDEE'] },
        },
      }),
    ).toBe(3);
  });

  it('justificatif photo : envoyé par l’auteur, lu par la gestion, jamais par un autre commerce', async () => {
    const depenseId = (await prisma.depense.findFirstOrThrow({ where: { caisseId } })).id;
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 9)]);
    await http()
      .put(`/api/depenses/${depenseId}/justificatif`)
      .auth(vendeur.jetonAcces, bearer)
      .attach('photo', jpeg, { filename: 'ticket.jpg', contentType: 'image/jpeg' })
      .expect(204);
    const lue = await http()
      .get(`/api/depenses/${depenseId}/justificatif`)
      .auth(gerant.jetonAcces, bearer)
      .buffer(true)
      .expect(200);
    expect(lue.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(lue.body as Buffer, jpeg)).toBe(0);
    const autre = await creerCommerce(prisma);
    try {
      const etranger = await connecter(app, autre.gerantA.identifiant);
      await http()
        .get(`/api/depenses/${depenseId}/justificatif`)
        .auth(etranger.jetonAcces, bearer)
        .expect(404);
    } finally {
      await supprimerCommerce(prisma, autre.commerce.id);
    }
  });
});
