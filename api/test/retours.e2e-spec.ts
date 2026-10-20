import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type RetourSaisi, type VenteSaisie } from '@gestvente/commun';
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

const JOUR = 86_400_000;

describe('Retours et échanges (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let telephoneId: string;
  let haut: string;
  let coqueId: string;
  let clientId: string;
  const articles: { id: string; imei: string }[] = [];
  const articlesHaut: { id: string; imei: string }[] = [];
  let numero = 0;
  let suivant = 0;
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

  /** Vente au comptant (paiement exact en espèces), datée de `ilYa` jours. */
  const vendre = async (
    lignes: { produitId: string; articleId?: string; quantite?: number; prixUnitaire: number }[],
    options: { ilYa?: number; remise?: number; clientId?: string | null } = {},
  ) => {
    const contenu = nouvelleVente(lignes, options.remise ?? 0, null);
    contenu.clientId = options.clientId ?? null;
    contenu.dateVente = new Date(Date.now() - (options.ilYa ?? 0) * JOUR).toISOString();
    expect(await envoyer(gerant, 'VENTE_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    return prisma.vente.findUniqueOrThrow({ where: { id: contenu.id }, include: { lignes: true } });
  };

  const nouvelleVente = (
    lignes: { produitId: string; articleId?: string; quantite?: number; prixUnitaire: number }[],
    remise: number,
    aPayer: number | null,
  ): VenteSaisie => {
    const completes = lignes.map((l) => ({
      id: randomUUID(),
      produitId: l.produitId,
      articleId: l.articleId ?? null,
      quantite: l.quantite ?? 1,
      tarif: 'DETAIL' as const,
      prixUnitaire: l.prixUnitaire,
    }));
    const total = aPayer ?? completes.reduce((t, l) => t + l.quantite * l.prixUnitaire, 0) - remise;
    return {
      id: randomUUID(),
      numero: `RET-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: completes,
      remise,
      paiements: total
        ? [{ id: randomUUID(), moyen: 'ESPECES', montant: total, reference: null }]
        : [],
      autorisationRemise: null,
    };
  };

  const retour = (
    venteId: string,
    lignes: {
      ligneVenteId: string;
      quantite?: number;
      destination?: 'REMISE_EN_STOCK' | 'OCCASION' | 'REBUT';
      prixRevente?: number;
    }[],
    surcharge: Partial<RetourSaisi> = {},
  ): RetourSaisi => ({
    id: randomUUID(),
    venteId,
    dateRetour: new Date().toISOString(),
    type: 'REMBOURSEMENT',
    etatAppareil: 'INTACT',
    motif: 'Le client a changé d’avis',
    lignes: lignes.map((l) => ({
      id: randomUUID(),
      ligneVenteId: l.ligneVenteId,
      quantite: l.quantite ?? 1,
      destination: l.destination ?? 'REMISE_EN_STOCK',
      prixRevente: l.prixRevente ?? null,
    })),
    remboursement: { moyen: 'ESPECES', reference: null },
    echange: null,
    autorisation: null,
    ...surcharge,
  });

  const telephone = () => articles[suivant++];
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
    const produit = (nom: string, prix: number) =>
      prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: catTel.id,
          nom,
          garantieMois: 12,
          prixAchat: prix - 300_000,
          prixDetail: prix,
          prixGros: prix - 100_000,
        },
      });
    telephoneId = (await produit('Redmi 13', 1_900_000)).id;
    haut = (await produit('Galaxy A55', 2_300_000)).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: catAcc.id,
          nom: 'Coque Redmi 13',
          prixAchat: 15_000,
          prixDetail: 50_000,
          prixGros: 40_000,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 8 },
        { produitId: haut, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 100 },
      ],
    });
    for (let i = 1; i <= 8; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: telephoneId,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`36${base}000${i}`),
          prixAchat: 1_600_000,
        },
      });
      articles.push({ id: a.id, imei: a.imei });
    }
    for (let i = 1; i <= 3; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: haut,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`37${base}000${i}`),
          prixAchat: 2_000_000,
        },
      });
      articlesHaut.push({ id: a.id, imei: a.imei });
    }
    clientId = (
      await prisma.client.create({
        data: { commerceId, nom: 'Aminata', telephone: '+224620555444' },
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

  it('remboursement : valeur payée (remise au prorata), remise en stock ou rebut, retour partiel', async () => {
    const tel = telephone();
    const vente = await vendre(
      [
        { produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_900_000 },
        { produitId: coqueId, quantite: 2, prixUnitaire: 50_000 },
      ],
      { remise: 100_000 },
    );
    const ligneTel = vente.lignes.find((l) => l.articleId)!;
    const ligneCoque = vente.lignes.find((l) => !l.articleId)!;
    const coques = await stock(coqueId);
    const telephones = await stock(telephoneId);
    const contenu = retour(vente.id, [
      { ligneVenteId: ligneTel.id },
      { ligneVenteId: ligneCoque.id, destination: 'REBUT' },
    ]);
    expect(await envoyer(gerant, 'RETOUR_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    // 1 900 000 × 1 900 000 / 2 000 000 = 1 805 000 ; 50 000 × 0,95 = 47 500.
    expect(await prisma.retour.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      valeur: 1_852_500n,
      montantRembourse: 1_852_500n,
      moyenRemboursement: 'ESPECES',
      valideParId: d.gerantA.id,
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: tel.id } })).statut).toBe(
      'EN_STOCK',
    );
    expect(await stock(telephoneId)).toBe(telephones + 1);
    expect(await stock(coqueId)).toBe(coques);
    expect(
      await prisma.journalAudit.count({
        where: { action: 'RETOUR_ENREGISTRE', entiteId: contenu.id },
      }),
    ).toBe(1);

    // La seconde coque peut encore être rendue, pas une troisième.
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(vente.id, [{ ligneVenteId: ligneCoque.id }]),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    const encore = await envoyer(
      gerant,
      'RETOUR_ENREGISTRER',
      retour(vente.id, [{ ligneVenteId: ligneCoque.id }]),
    );
    expect(encore).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/2 sur 2/) });
    expect(encore.corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({ entite: 'retour', donnees: null })]),
    );

    // Historique de l'IMEI : le retour y figure.
    const { body } = await http()
      .get(`/api/articles/imei/${tel.imei}`)
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(body.evenements.map((e: { type: string }) => e.type)).toContain('RETOUR');
  });

  it('vendeur : refusé sans le PIN du gérant, accepté avec son jeton (pour cette vente seulement)', async () => {
    const tel = telephone();
    const vente = await vendre([
      { produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_900_000 },
    ]);
    const autre = await vendre([{ produitId: coqueId, prixUnitaire: 50_000 }]);
    const lignes = [{ ligneVenteId: vente.lignes[0].id }];
    expect((await envoyer(vendeur, 'RETOUR_ENREGISTRER', retour(vente.id, lignes))).motif).toMatch(
      /PIN d’un gérant/,
    );

    await http()
      .post('/api/ventes/autorisations-retour')
      .auth(vendeur.jetonAcces, bearer)
      .send({
        boutiqueId: d.boutiqueA.id,
        identifiant: d.gerantA.identifiant,
        pin: '0000',
        venteId: vente.id,
      })
      .expect(401);
    const { body } = await http()
      .post('/api/ventes/autorisations-retour')
      .auth(vendeur.jetonAcces, bearer)
      .send({
        boutiqueId: d.boutiqueA.id,
        identifiant: d.gerantA.identifiant,
        pin: '2580',
        venteId: autre.id,
      })
      .expect(200);
    expect(
      (
        await envoyer(
          vendeur,
          'RETOUR_ENREGISTRER',
          retour(vente.id, lignes, { autorisation: body.jeton }),
        )
      ).statut,
    ).toBe('REJETEE');

    const valide = await http()
      .post('/api/ventes/autorisations-retour')
      .auth(vendeur.jetonAcces, bearer)
      .send({
        boutiqueId: d.boutiqueA.id,
        identifiant: d.gerantA.identifiant,
        pin: '2580',
        venteId: vente.id,
      })
      .expect(200);
    const contenu = retour(vente.id, lignes, { autorisation: valide.body.jeton });
    expect(await envoyer(vendeur, 'RETOUR_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect((await prisma.retour.findUniqueOrThrow({ where: { id: contenu.id } })).valideParId).toBe(
      d.gerantA.id,
    );
  });

  it('avoir : porté au solde du client, puis payé comme moyen « Avoir »', async () => {
    const vente = await vendre([{ produitId: coqueId, quantite: 3, prixUnitaire: 50_000 }], {
      clientId,
    });
    const sansClient = await vendre([{ produitId: coqueId, prixUnitaire: 50_000 }]);
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(sansClient.id, [{ ligneVenteId: sansClient.lignes[0].id }], {
            type: 'AVOIR',
            remboursement: null,
          }),
        )
      ).motif,
    ).toMatch(/pas de client/);
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(vente.id, [{ ligneVenteId: vente.lignes[0].id, quantite: 2 }], {
            type: 'AVOIR',
            remboursement: null,
          }),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).soldeAvoir).toBe(
      100_000n,
    );

    const achat = nouvelleVente([{ produitId: coqueId, prixUnitaire: 50_000 }], 0, null);
    achat.clientId = clientId;
    achat.paiements = [{ id: randomUUID(), moyen: 'AVOIR', montant: 50_000, reference: null }];
    expect(await envoyer(vendeur, 'VENTE_ENREGISTRER', achat)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).soldeAvoir).toBe(
      50_000n,
    );

    const tropCher = nouvelleVente(
      [{ produitId: coqueId, quantite: 2, prixUnitaire: 50_000 }],
      0,
      null,
    );
    tropCher.clientId = clientId;
    tropCher.paiements = [{ id: randomUUID(), moyen: 'AVOIR', montant: 100_000, reference: null }];
    const refus = await envoyer(vendeur, 'VENTE_ENREGISTRER', tropCher);
    expect(refus).toMatchObject({
      statut: 'CONFLIT',
      motif: expect.stringMatching(/Avoir insuffisant/),
    });
    expect(refus.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entite: 'client',
          donnees: expect.objectContaining({ soldeAvoir: 50_000 }),
        }),
      ]),
    );

    // Annuler la vente payée par avoir rend l'avoir.
    expect(
      (await envoyer(gerant, 'VENTE_ANNULER', { venteId: achat.id, motif: 'Erreur' })).statut,
    ).toBe('APPLIQUEE');
    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).soldeAvoir).toBe(
      100_000n,
    );
  });

  it('échange plus cher : le client paie la différence ; le rendu revendu d’occasion', async () => {
    const tel = telephone();
    const vente = await vendre(
      [{ produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_900_000 }],
      {
        ilYa: 2,
      },
    );
    const nouveau = nouvelleVente(
      [{ produitId: haut, articleId: articlesHaut[0].id, prixUnitaire: 2_300_000 }],
      0,
      400_000,
    );
    const contenu = retour(
      vente.id,
      [{ ligneVenteId: vente.lignes[0].id, destination: 'OCCASION', prixRevente: 1_500_000 }],
      {
        type: 'ECHANGE',
        remboursement: null,
        echange: nouveau,
      },
    );
    expect(await envoyer(gerant, 'RETOUR_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect(await prisma.vente.findUniqueOrThrow({ where: { id: nouveau.id } })).toMatchObject({
      sousTotal: 2_300_000n,
      reprise: 1_900_000n,
      total: 400_000n,
    });
    expect(await prisma.retour.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      venteEchangeId: nouveau.id,
      montantRembourse: 0n,
    });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: tel.id } })).toMatchObject({
      statut: 'EN_STOCK',
      prixRevente: 1_500_000n,
    });
    expect(
      (await prisma.article.findUniqueOrThrow({ where: { id: articlesHaut[0].id } })).statut,
    ).toBe('VENDU');

    // Revendu d'occasion à son prix : aucun écart de prix signalé.
    const occasion = nouvelleVente(
      [{ produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_500_000 }],
      0,
      null,
    );
    expect((await envoyer(gerant, 'VENTE_ENREGISTRER', occasion)).statut).toBe('APPLIQUEE');
    expect(
      await prisma.journalAudit.count({ where: { action: 'ECART_PRIX', entiteId: occasion.id } }),
    ).toBe(0);
  });

  it('échange moins cher : la différence est rendue (moyen obligatoire) ; paiement manquant refusé', async () => {
    const vente = await vendre([
      { produitId: haut, articleId: articlesHaut[1].id, prixUnitaire: 2_300_000 },
    ]);
    const lignes = [{ ligneVenteId: vente.lignes[0].id }];
    const tel = telephone();
    const echange = () =>
      nouvelleVente([{ produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_900_000 }], 0, 0);
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(vente.id, lignes, { type: 'ECHANGE', remboursement: null, echange: echange() }),
        )
      ).motif,
    ).toMatch(/comment le client est remboursé/);
    const contenu = retour(vente.id, lignes, {
      type: 'ECHANGE',
      remboursement: { moyen: 'ORANGE_MONEY', reference: 'OM-778' },
      echange: echange(),
    });
    expect(await envoyer(gerant, 'RETOUR_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect(await prisma.retour.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      montantRembourse: 400_000n,
      moyenRemboursement: 'ORANGE_MONEY',
      referenceRemboursement: 'OM-778',
    });

    // Échange plus cher sans payer la différence : refusé, rien n'est écrit.
    const autreVente = await vendre([{ produitId: coqueId, prixUnitaire: 50_000 }]);
    const refus = retour(autreVente.id, [{ ligneVenteId: autreVente.lignes[0].id }], {
      type: 'ECHANGE',
      remboursement: null,
      echange: nouvelleVente(
        [{ produitId: haut, articleId: articlesHaut[2].id, prixUnitaire: 2_300_000 }],
        0,
        0,
      ),
    });
    expect((await envoyer(gerant, 'RETOUR_ENREGISTRER', refus)).motif).toMatch(
      /Échange : Il manque/,
    );
    expect(await prisma.retour.count({ where: { id: refus.id } })).toBe(0);
    expect(
      (await prisma.article.findUniqueOrThrow({ where: { id: articlesHaut[2].id } })).statut,
    ).toBe('EN_STOCK');
  });

  it('conditions : délai dépassé, appareil endommagé, échange sous garantie', async () => {
    const tel = telephone();
    const vente = await vendre(
      [{ produitId: telephoneId, articleId: tel.id, prixUnitaire: 1_900_000 }],
      {
        ilYa: 30,
      },
    );
    const lignes = [{ ligneVenteId: vente.lignes[0].id }];
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(vente.id, lignes, { etatAppareil: 'DEFECTUEUX' }),
        )
      ).motif,
    ).toMatch(/délai : 7 jours/);
    expect(
      (
        await envoyer(
          gerant,
          'RETOUR_ENREGISTRER',
          retour(vente.id, lignes, {
            etatAppareil: 'ENDOMMAGE',
            type: 'ECHANGE',
            remboursement: null,
          }),
        )
      ).motif,
    ).toMatch(/endommagé/);
    const autreTel = telephone();
    const contenu = retour(vente.id, [{ ligneVenteId: vente.lignes[0].id, destination: 'REBUT' }], {
      type: 'ECHANGE',
      etatAppareil: 'DEFECTUEUX',
      motif: 'Écran noir au démarrage',
      remboursement: null,
      echange: nouvelleVente(
        [{ produitId: telephoneId, articleId: autreTel.id, prixUnitaire: 1_900_000 }],
        0,
        0,
      ),
    });
    expect(await envoyer(gerant, 'RETOUR_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect((await prisma.article.findUniqueOrThrow({ where: { id: tel.id } })).statut).toBe(
      'REBUT',
    );
  });
});
