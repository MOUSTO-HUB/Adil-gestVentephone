import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type VenteSaisie } from '@gestvente/commun';
import { hash } from '@node-rs/argon2';
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

describe('Ventes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let telephoneId: string;
  let coqueId: string;
  let articles: { id: string; imei: string }[];
  let clientDetail: string;
  let clientGrossiste: string;
  let numero = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);

  const envoyer = async (
    session: SessionTest,
    type: string,
    contenu: unknown,
    faiteLe = new Date(),
  ) =>
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
                faiteLe: faiteLe.toISOString(),
                contenu,
              },
            ],
          })
          .expect(200)
      ).body.resultats as ResultatOp[]
    )[0];

  /** Vente : lignes (téléphone par article, accessoire par quantité), paiement en espèces exact. */
  const vente = (
    lignes: {
      produitId: string;
      articleId?: string;
      quantite?: number;
      tarif?: string;
      prixUnitaire: number;
    }[],
    surcharge: Record<string, unknown> = {},
  ) => {
    const lignesCompletes = lignes.map((l) => ({
      id: randomUUID(),
      produitId: l.produitId,
      articleId: l.articleId ?? null,
      quantite: l.quantite ?? 1,
      tarif: l.tarif ?? 'DETAIL',
      prixUnitaire: l.prixUnitaire,
    }));
    const remise = (surcharge.remise as number | undefined) ?? 0;
    const total = lignesCompletes.reduce((t, l) => t + l.quantite * l.prixUnitaire, 0) - remise;
    return {
      id: randomUUID(),
      numero: `TEST-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: lignesCompletes,
      remise,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: total, reference: null }],
      autorisationRemise: null,
      ...surcharge,
    } as VenteSaisie;
  };

  const stock = async (produitId: string) =>
    (await prisma.stock.findFirstOrThrow({ where: { produitId, boutiqueId: d.boutiqueA.id } }))
      .quantite;

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
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: catTel.id,
          nom: 'Galaxy A15',
          garantieMois: 12,
          prixAchat: 1_600_000,
          prixDetail: 1_900_000,
          prixGros: 1_780_000,
          seuilGros: 5,
        },
      })
    ).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: catAcc.id,
          nom: 'Coque A15',
          prixAchat: 15_000,
          prixDetail: 35_000,
          prixGros: 27_000,
          seuilGros: 10,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 50 },
      ],
    });
    articles = [];
    for (let i = 1; i <= 3; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: telephoneId,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`35${base}000${i}`),
          prixAchat: 1_550_000,
        },
      });
      articles.push({ id: a.id, imei: a.imei });
    }
    clientDetail = (
      await prisma.client.create({
        data: { commerceId, nom: 'Client', telephone: '+224620000001' },
      })
    ).id;
    clientGrossiste = (
      await prisma.client.create({
        data: { commerceId, nom: 'Grossiste', telephone: '+224620000002', type: 'GROSSISTE' },
      })
    ).id;
    await prisma.utilisateur.update({
      where: { id: d.gerantA.id },
      data: { pinHash: await hash('2580') },
    });
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('vente au détail : téléphone et accessoires, rendu de monnaie, stock et garantie', async () => {
    const contenu = vente([
      { produitId: telephoneId, articleId: articles[0].id, prixUnitaire: 1_900_000 },
      { produitId: coqueId, quantite: 2, prixUnitaire: 35_000 },
    ]);
    contenu.clientId = clientDetail;
    contenu.paiements = [
      { id: randomUUID(), moyen: 'ESPECES', montant: 2_000_000, reference: null },
    ];
    expect(await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });

    const enBase = await prisma.vente.findUniqueOrThrow({
      where: { id: contenu.id },
      include: { lignes: true },
    });
    expect(enBase).toMatchObject({
      total: 1_970_000n,
      renduMonnaie: 30_000n,
      vendeurId: d.vendeurA.id,
      statut: 'VALIDEE',
    });
    const ligneTel = enBase.lignes.find((l) => l.articleId)!;
    expect(ligneTel.prixAchat).toBe(1_550_000n);
    expect(ligneTel.finGarantie?.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 1);
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articles[0].id } })).statut).toBe(
      'VENDU',
    );
    expect(await stock(telephoneId)).toBe(2);
    expect(await stock(coqueId)).toBe(48);
    expect(
      await prisma.mouvementStock.count({ where: { referenceId: contenu.id, type: 'VENTE' } }),
    ).toBe(2);

    // Le vendeur retrouve la vente sur ses appareils, sans les coûts d'achat.
    const { body } = await http().get('/api/sync/instantane').auth(vendeur.jetonAcces, bearer);
    expect(body.donnees.vente.map((v: { id: string }) => v.id)).toContain(contenu.id);
    expect(body.donnees.ligneVente.every((l: { prixAchat: unknown }) => l.prixAchat === null)).toBe(
      true,
    );
    expect(body.donnees.paiementVente).toEqual([
      expect.objectContaining({ venteId: contenu.id, montant: 2_000_000 }),
    ]);
  });

  it('le même téléphone vendu par un autre appareil : conflit, la vente est effacée sur l’appareil', async () => {
    const contenu = vente([
      { produitId: telephoneId, articleId: articles[0].id, prixUnitaire: 1_900_000 },
    ]);
    const r = await envoyer(gerant, 'VENTE_ENREGISTRER', contenu);
    expect(r).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/déjà été vendu/) });
    expect(r.corrections).toEqual(
      expect.arrayContaining([
        { seq: 0, entite: 'vente', id: contenu.id, donnees: null },
        expect.objectContaining({
          entite: 'article',
          id: articles[0].id,
          donnees: expect.objectContaining({ statut: 'VENDU' }),
        }),
      ]),
    );
    expect(await prisma.vente.count({ where: { id: contenu.id } })).toBe(0);
  });

  it('prix de gros : dès le seuil ou pour un client grossiste, refusé sinon', async () => {
    expect(
      (
        await envoyer(
          vendeur,
          'VENTE_ENREGISTRER',
          vente([{ produitId: coqueId, quantite: 10, tarif: 'GROS', prixUnitaire: 27_000 }]),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    const sansDroit = await envoyer(
      vendeur,
      'VENTE_ENREGISTRER',
      vente([{ produitId: coqueId, quantite: 5, tarif: 'GROS', prixUnitaire: 27_000 }]),
    );
    expect(sansDroit.motif).toMatch(/gros réservé/);
    const grossiste = vente([
      { produitId: coqueId, quantite: 1, tarif: 'GROS', prixUnitaire: 27_000 },
    ]);
    grossiste.clientId = clientGrossiste;
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', grossiste)).statut).toBe('APPLIQUEE');
  });

  describe('remises', () => {
    // Fonction : coqueId n'existe qu'après beforeAll.
    const ligne = () => [{ produitId: coqueId, quantite: 4, prixUnitaire: 25_000 }];

    it('dans le plafond du vendeur (5 %) : acceptée et journalisée', async () => {
      const contenu = vente(ligne(), { remise: 5_000 });
      expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).statut).toBe('APPLIQUEE');
      const journal = await prisma.journalAudit.findFirst({
        where: { action: 'REMISE_ACCORDEE', entiteId: contenu.id },
      });
      expect(journal?.details).toMatchObject({ pourcentage: 5, autorisePar: null });
    });

    it('au-delà : refusée sans le gérant, acceptée avec son autorisation', async () => {
      expect(
        (await envoyer(vendeur, 'VENTE_ENREGISTRER', vente(ligne(), { remise: 10_000 }))).motif,
      ).toMatch(/gérant doit la valider/);
      const demande = {
        boutiqueId: d.boutiqueA.id,
        identifiant: d.gerantA.identifiant,
        pourcentage: 10,
      };
      await http()
        .post('/api/ventes/autorisations-remise')
        .auth(vendeur.jetonAcces, bearer)
        .send({ ...demande, pin: '1111' })
        .expect(401);
      await http()
        .post('/api/ventes/autorisations-remise')
        .auth(vendeur.jetonAcces, bearer)
        .send({ ...demande, pin: '2580', pourcentage: 20 })
        .expect(403);
      const { body } = await http()
        .post('/api/ventes/autorisations-remise')
        .auth(vendeur.jetonAcces, bearer)
        .send({ ...demande, pin: '2580' })
        .expect(200);
      expect(body).toMatchObject({ gerant: d.gerantA.nom, plafond: 15 });

      const contenu = vente(ligne(), { remise: 10_000, autorisationRemise: body.jeton });
      expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).statut).toBe('APPLIQUEE');
      const journal = await prisma.journalAudit.findFirst({
        where: { action: 'REMISE_ACCORDEE', entiteId: contenu.id },
      });
      expect(journal?.details).toMatchObject({ pourcentage: 10, autorisePar: d.gerantA.id });

      // L'autorisation ne couvre pas plus que le plafond du gérant, ni un faux jeton.
      expect(
        (
          await envoyer(
            vendeur,
            'VENTE_ENREGISTRER',
            vente(ligne(), { remise: 20_000, autorisationRemise: body.jeton }),
          )
        ).motif,
      ).toMatch(/au-delà de ce que le gérant/);
      expect(
        (
          await envoyer(
            vendeur,
            'VENTE_ENREGISTRER',
            vente(ligne(), { remise: 10_000, autorisationRemise: `${body.jeton}x` }),
          )
        ).motif,
      ).toMatch(/gérant doit la valider/);
    });
  });

  it('paiements : insuffisant, référence mobile money manquante, mixte', async () => {
    const insuffisant = vente([{ produitId: coqueId, prixUnitaire: 35_000 }]);
    insuffisant.paiements = [
      { id: randomUUID(), moyen: 'ESPECES', montant: 30_000, reference: null },
    ];
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', insuffisant)).motif).toMatch(/Il manque/);

    const sansReference = vente([{ produitId: coqueId, prixUnitaire: 35_000 }]);
    sansReference.paiements = [
      { id: randomUUID(), moyen: 'ORANGE_MONEY', montant: 35_000, reference: null },
    ];
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', sansReference)).motif).toMatch(/référence/);

    const mixte = vente([
      { produitId: telephoneId, articleId: articles[1].id, prixUnitaire: 1_900_000 },
    ]);
    mixte.paiements = [
      { id: randomUUID(), moyen: 'MTN_MOMO', montant: 1_000_000, reference: 'MP2610.1234' },
      { id: randomUUID(), moyen: 'ESPECES', montant: 1_000_000, reference: null },
    ];
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', mixte)).statut).toBe('APPLIQUEE');
    expect((await prisma.vente.findUniqueOrThrow({ where: { id: mixte.id } })).renduMonnaie).toBe(
      100_000n,
    );
  });

  it('prix changé pendant que l’appareil était hors ligne : vente gardée, écart audité', async () => {
    const contenu = vente([{ produitId: coqueId, prixUnitaire: 33_000 }]);
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).statut).toBe('APPLIQUEE');
    const journal = await prisma.journalAudit.findFirst({
      where: { action: 'ECART_PRIX', entiteId: contenu.id },
    });
    expect(journal?.details).toMatchObject({ ecarts: [{ saisi: 33_000, actuel: 35_000 }] });
  });

  it('numéro de facture unique dans la boutique', async () => {
    const premiere = vente([{ produitId: coqueId, prixUnitaire: 35_000 }]);
    await envoyer(vendeur, 'VENTE_ENREGISTRER', premiere);
    const doublon = vente([{ produitId: coqueId, prixUnitaire: 35_000 }], {
      numero: premiere.numero,
    });
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', doublon)).motif).toMatch(/déjà utilisé/);
  });

  it('annulation : réservée au gérant, avec motif ; le stock revient', async () => {
    const contenu = vente([
      { produitId: telephoneId, articleId: articles[2].id, prixUnitaire: 1_900_000 },
      { produitId: coqueId, quantite: 3, prixUnitaire: 35_000 },
    ]);
    await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu);
    const coquesAvant = await stock(coqueId);
    expect(
      (await envoyer(vendeur, 'VENTE_ANNULER', { venteId: contenu.id, motif: 'Erreur de saisie' }))
        .motif,
    ).toMatch(/rôle/);
    expect(
      (await envoyer(gerant, 'VENTE_ANNULER', { venteId: contenu.id, motif: 'Erreur de saisie' }))
        .statut,
    ).toBe('APPLIQUEE');

    expect(await prisma.vente.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      statut: 'ANNULEE',
      motifAnnulation: 'Erreur de saisie',
      annuleParId: d.gerantA.id,
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: articles[2].id } })).statut).toBe(
      'EN_STOCK',
    );
    expect(await stock(coqueId)).toBe(coquesAvant + 3);
    expect(
      await prisma.journalAudit.count({ where: { action: 'VENTE_ANNULEE', entiteId: contenu.id } }),
    ).toBe(1);
    // Une seconde annulation ne change rien.
    expect(
      (await envoyer(gerant, 'VENTE_ANNULER', { venteId: contenu.id, motif: 'Encore' })).statut,
    ).toBe('APPLIQUEE');
    expect(await stock(coqueId)).toBe(coquesAvant + 3);
  });
});
