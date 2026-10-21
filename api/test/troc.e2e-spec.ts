import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type TrocSaisi, type VenteSaisie } from '@gestvente/commun';
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

/** Image JPEG minimale (en-tête reconnu par le contrôle de format). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

describe('Troc (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let proprietaire: SessionTest;
  let neufId: string;
  let iphone12Id: string;
  let modele12Id: string;
  let neufs: string[];
  let clientSansPiece: string;
  let client: string;
  let numero = 0;
  let imeiSuivant = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);
  const nouvelImei = () => completerImei(`86${base}${String(++imeiSuivant).padStart(4, '0')}`);

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

  /** Ancien iPhone 12 du client, en bon état (un composant moyen). */
  const troc = (surcharge: Partial<TrocSaisi> = {}): TrocSaisi => ({
    id: randomUUID(),
    articleId: randomUUID(),
    produitId: iphone12Id,
    imei: nouvelImei(),
    etatEcran: 'BON',
    etatBatterie: 'MOYEN',
    etatBoitier: 'BON',
    fonctionne: true,
    note: 'Rayure au dos',
    valeurProposee: 1_500_000,
    valeurRetenue: 1_500_000,
    destination: 'A_REVENDRE',
    prixRevente: 2_200_000,
    autorisation: null,
    ...surcharge,
  });

  /** Vente d'un neuf (9 000 000) au client, la reprise déduite, le reste en espèces. */
  const venteAvecTroc = (
    articleId: string,
    t: TrocSaisi | null,
    clientId: string | null = client,
  ) =>
    ({
      id: randomUUID(),
      numero: `TROC-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId,
      lignes: [
        {
          id: randomUUID(),
          produitId: neufId,
          articleId,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 9_000_000,
        },
      ],
      remise: 0,
      paiements: [
        {
          id: randomUUID(),
          moyen: 'ESPECES',
          montant: 9_000_000 - (t?.valeurRetenue ?? 0),
          reference: null,
        },
      ],
      autorisationRemise: null,
      troc: t,
    }) as VenteSaisie;

  const autoriser = (session: SessionTest, trocId: string, valeur: number, pin: string) =>
    http().post('/api/ventes/autorisations-reprise').auth(session.jetonAcces, bearer).send({
      boutiqueId: d.boutiqueA.id,
      identifiant: d.gerantA.identifiant,
      pin,
      trocId,
      valeur,
    });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Smartphones', type: 'TELEPHONE' },
    });
    const marque = await prisma.marque.create({ data: { commerceId, nom: 'iPhone' } });
    modele12Id = (
      await prisma.modele.create({ data: { commerceId, marqueId: marque.id, nom: '12' } })
    ).id;
    const modele16 = await prisma.modele.create({
      data: { commerceId, marqueId: marque.id, nom: '16' },
    });
    const telephone = (nom: string, modeleId: string, prixDetail: number) =>
      prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: categorie.id,
          marqueId: marque.id,
          modeleId,
          capacite: '128 Go',
          nom,
          garantieMois: 3,
          prixAchat: prixDetail - 500_000,
          prixDetail,
          prixGros: prixDetail - 200_000,
        },
      });
    neufId = (await telephone('iPhone 16 128 Go', modele16.id, 9_000_000)).id;
    iphone12Id = (await telephone('iPhone 12 128 Go', modele12Id, 3_000_000)).id;
    await prisma.stock.create({
      data: { produitId: neufId, boutiqueId: d.boutiqueA.id, quantite: 8 },
    });
    neufs = [];
    for (let i = 0; i < 8; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: neufId,
          boutiqueId: d.boutiqueA.id,
          imei: nouvelImei(),
          prixAchat: 8_500_000,
        },
      });
      neufs.push(a.id);
    }
    clientSansPiece = (
      await prisma.client.create({
        data: { commerceId, nom: 'Sans pièce', telephone: '+224620000011' },
      })
    ).id;
    client = (
      await prisma.client.create({
        data: {
          commerceId,
          nom: 'Mamadou Diallo',
          telephone: '+224620000012',
          typePiece: 'CNI',
          numeroPiece: 'GN-458712',
        },
      })
    ).id;
    await prisma.utilisateur.update({
      where: { id: d.gerantA.id },
      data: { pinHash: await hash('2580') },
    });
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('fiche client avec pièce d’identité obligatoire', async () => {
    const sansClient = await envoyer(
      vendeur,
      'VENTE_ENREGISTRER',
      venteAvecTroc(neufs[0], troc(), null),
    );
    expect(sansClient).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/fiche/) });
    const sansPiece = await envoyer(
      vendeur,
      'VENTE_ENREGISTRER',
      venteAvecTroc(neufs[0], troc(), clientSansPiece),
    );
    expect(sansPiece).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/pièce/) });
    // Troc refusé : l'article provisoire disparaît de l'appareil.
    expect(sansPiece.corrections).toEqual(
      expect.arrayContaining([expect.objectContaining({ entite: 'article', donnees: null })]),
    );
  });

  it('la reprise est déduite du neuf ; l’appareil entre en stock d’occasion à sa valeur', async () => {
    const t = troc();
    const contenu = venteAvecTroc(neufs[0], t);
    expect(await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect(await prisma.vente.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      sousTotal: 9_000_000n,
      reprise: 1_500_000n,
      total: 7_500_000n,
    });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: t.articleId } })).toMatchObject({
      imei: t.imei,
      produitId: iphone12Id,
      statut: 'EN_STOCK',
      origine: 'TROC',
      prixAchat: 1_500_000n,
      prixRevente: 2_200_000n,
    });
    expect(
      (await prisma.stock.findFirstOrThrow({ where: { produitId: iphone12Id } })).quantite,
    ).toBe(1);
    expect(await prisma.troc.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      venteId: contenu.id,
      clientId: client,
      etatGlobal: 'BON',
      valeurProposee: 1_500_000n,
      valeurRetenue: 1_500_000n,
      note: 'Rayure au dos',
    });
    expect(
      await prisma.mouvementStock.count({ where: { articleId: t.articleId, type: 'TROC_ENTREE' } }),
    ).toBe(1);
    // Une vente avec troc ne s'annule pas : le téléphone repris est déjà en stock.
    expect(
      await envoyer(gerant, 'VENTE_ANNULER', { venteId: contenu.id, motif: 'Erreur de saisie' }),
    ).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/troc/) });
  });

  it('au-delà de 10 % de la valeur proposée, le PIN du gérant est exigé', async () => {
    const t = troc({ valeurRetenue: 1_700_000 });
    expect(await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[1], t))).toMatchObject({
      statut: 'REJETEE',
      motif: expect.stringMatching(/gérant/),
    });
    await autoriser(vendeur, t.id, 1_700_000, '0000').expect(401);
    const { body } = await autoriser(vendeur, t.id, 1_700_000, '2580').expect(200);
    // Jeton d'un autre troc : refusé.
    const autre = troc({ valeurRetenue: 1_700_000, autorisation: body.jeton });
    expect(
      (await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[1], autre))).statut,
    ).toBe('REJETEE');
    const valide = { ...t, autorisation: body.jeton };
    expect(
      (await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[1], valide))).statut,
    ).toBe('APPLIQUEE');
    expect(await prisma.troc.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      ajustementParId: d.gerantA.id,
      valeurRetenue: 1_700_000n,
    });
    expect(
      await prisma.journalAudit.count({ where: { entiteId: t.id, action: 'REPRISE_AJUSTEE' } }),
    ).toBe(1);
  });

  it('grille du propriétaire : elle fixe la valeur proposée', async () => {
    const grille = {
      modeleId: modele12Id,
      capacite: '128 Go',
      lignes: [{ id: randomUUID(), etat: 'BON', valeur: 2_000_000 }],
    };
    expect((await envoyer(gerant, 'GRILLE_REPRISE_ENREGISTRER', grille)).statut).toBe('REJETEE');
    expect((await envoyer(proprietaire, 'GRILLE_REPRISE_ENREGISTRER', grille)).statut).toBe(
      'APPLIQUEE',
    );
    // Grille du serveur : 2 000 000 ; le vendeur peut aller jusqu'à 2 200 000.
    const t = troc({ valeurProposee: 1_500_000, valeurRetenue: 2_150_000 });
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[2], t))).statut).toBe(
      'APPLIQUEE',
    );
    expect((await prisma.troc.findUniqueOrThrow({ where: { id: t.id } })).valeurProposee).toBe(
      2_000_000n,
    );
    // Grille remplacée : l'ancienne ligne disparaît.
    const nouvelle = { ...grille, lignes: [{ id: randomUUID(), etat: 'BON', valeur: 1_900_000 }] };
    expect((await envoyer(proprietaire, 'GRILLE_REPRISE_ENREGISTRER', nouvelle)).statut).toBe(
      'APPLIQUEE',
    );
    expect(await prisma.grilleReprise.findMany({ where: { modeleId: modele12Id } })).toEqual([
      expect.objectContaining({ id: nouvelle.lignes[0].id, valeur: 1_900_000n }),
    ]);
  });

  it('IMEI signalé volé ou déjà en stock : la reprise est refusée', async () => {
    const vole = nouvelImei();
    const signalement = {
      id: randomUUID(),
      imei: vole,
      motif: 'VOLE',
      note: 'Plainte déposée',
      actif: true,
    };
    expect((await envoyer(vendeur, 'IMEI_SIGNALER', signalement)).statut).toBe('REJETEE');
    expect((await envoyer(gerant, 'IMEI_SIGNALER', signalement)).statut).toBe('APPLIQUEE');
    expect(
      await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[3], troc({ imei: vole }))),
    ).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/volé/) });

    const enStock = await prisma.article.findUniqueOrThrow({ where: { id: neufs[7] } });
    expect(
      await envoyer(
        vendeur,
        'VENTE_ENREGISTRER',
        venteAvecTroc(neufs[3], troc({ imei: enStock.imei })),
      ),
    ).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/déjà dans le stock/) });

    // Signalement levé : la reprise passe.
    expect((await envoyer(gerant, 'IMEI_SIGNALER', { ...signalement, actif: false })).statut).toBe(
      'APPLIQUEE',
    );
    expect(
      (await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[3], troc({ imei: vole }))))
        .statut,
    ).toBe('APPLIQUEE');
  });

  it('à réparer, puis remis en vente ; un téléphone revendu peut revenir en troc', async () => {
    const t = troc({ destination: 'A_REPARER', prixRevente: null, valeurRetenue: 900_000 });
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[4], t))).statut).toBe(
      'APPLIQUEE',
    );
    expect((await prisma.article.findUniqueOrThrow({ where: { id: t.articleId } })).statut).toBe(
      'A_REPARER',
    );
    const remise = { articleId: t.articleId, prixRevente: 1_800_000 };
    expect((await envoyer(vendeur, 'ARTICLE_REMETTRE_EN_VENTE', remise)).statut).toBe('REJETEE');
    expect((await envoyer(gerant, 'ARTICLE_REMETTRE_EN_VENTE', remise)).statut).toBe('APPLIQUEE');
    expect(await prisma.article.findUniqueOrThrow({ where: { id: t.articleId } })).toMatchObject({
      statut: 'EN_STOCK',
      prixRevente: 1_800_000n,
    });

    // Revendu d'occasion à son prix, au coût de la reprise…
    const revente = {
      id: randomUUID(),
      numero: `TROC-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: randomUUID(),
          produitId: iphone12Id,
          articleId: t.articleId,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 1_800_000,
        },
      ],
      remise: 0,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: 1_800_000, reference: null }],
      autorisationRemise: null,
    };
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', revente)).statut).toBe('APPLIQUEE');
    expect(
      (await prisma.ligneVente.findFirstOrThrow({ where: { venteId: revente.id } })).prixAchat,
    ).toBe(900_000n);

    // … puis repris de nouveau : le même article revient, l'identifiant provisoire est effacé.
    const encore = troc({ imei: t.imei, valeurRetenue: 800_000 });
    expect(
      (await envoyer(vendeur, 'VENTE_ENREGISTRER', venteAvecTroc(neufs[5], encore))).statut,
    ).toBe('APPLIQUEE');
    expect(await prisma.article.findUnique({ where: { id: encore.articleId } })).toBeNull();
    expect(await prisma.article.findUniqueOrThrow({ where: { id: t.articleId } })).toMatchObject({
      statut: 'EN_STOCK',
      prixAchat: 800_000n,
    });
    expect(await prisma.troc.count({ where: { articleId: t.articleId } })).toBe(2);
    expect(
      await prisma.changement.count({
        where: { commerceId: d.commerce.id, entite: 'article', entiteId: encore.articleId },
      }),
    ).toBe(1);
  });

  it('photos de l’appareil repris : ajoutées après la synchronisation, lues sans cache', async () => {
    const t = await prisma.troc.findFirstOrThrow({ where: { commerceId: d.commerce.id } });
    const envoyerPhoto = (contenu: Buffer) =>
      http()
        .post(`/api/trocs/${t.id}/photos`)
        .auth(vendeur.jetonAcces, bearer)
        .attach('photo', contenu, 'photo.jpg');
    await envoyerPhoto(Buffer.from('pas une image')).expect(400);
    for (let i = 0; i < 4; i++) await envoyerPhoto(JPEG).expect(204);
    await envoyerPhoto(JPEG).expect(409);
    const photo = await http()
      .get(`/api/trocs/${t.id}/photos/2`)
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(photo.headers['cache-control']).toBe('no-store');
    // Un vendeur d'une autre boutique ne la voit pas.
    const autre = await connecter(app, d.vendeurB.identifiant);
    await http().get(`/api/trocs/${t.id}/photos/1`).auth(autre.jetonAcces, bearer).expect(404);

    // Les appareils reçoivent trocs, grille et IMEI signalés.
    const { body } = await http()
      .get('/api/sync/instantane')
      .auth(vendeur.jetonAcces, bearer)
      .expect(200);
    expect(body.donnees.troc.find((x: { id: string }) => x.id === t.id)).toMatchObject({
      photos: 4,
    });
    expect(body.donnees.grilleReprise).toHaveLength(1);
    expect(body.donnees.imeiSignale).toHaveLength(1);
  });
});
