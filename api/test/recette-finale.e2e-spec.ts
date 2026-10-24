import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, lignesRecuEncaissement } from '@gestvente/commun';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RappelsService } from '../src/credits/rappels.service.js';
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
 * Recette finale : critères 3 à 7 du cahier des charges (les critères 1 et 2 sont
 * dans recette.e2e-spec.ts), et restauration des données sur un nouvel appareil.
 */
describe('Recette finale, phases 2 et 3 (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeurA: SessionTest;
  let vendeurB: SessionTest;
  let proprietaire: SessionTest;
  let telephoneId: string;
  let coqueId: string;
  let articles: string[];
  let client: string;
  let creditId: string;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);
  let n = 0;
  let imeis = 0;
  const imei = () => completerImei(`92${base}${String(++imeis).padStart(4, '0')}`);

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
    return body.resultats[0] as { statut: string; motif?: string };
  };
  const ligneTel = (articleId: string, prix = 2_000_000) => ({
    id: randomUUID(),
    produitId: telephoneId,
    articleId,
    quantite: 1,
    tarif: 'DETAIL',
    prixUnitaire: prix,
  });
  const vente = (lignes: object[], paye: number, extra: object = {}) => ({
    id: randomUUID(),
    numero: `RF-${base}-${++n}`,
    dateVente: new Date().toISOString(),
    clientId: null,
    lignes,
    remise: 0,
    paiements: paye ? [{ id: randomUUID(), moyen: 'ESPECES', montant: paye, reference: null }] : [],
    autorisationRemise: null,
    ...extra,
  });
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
          nom: 'Infinix Hot 40',
          prixAchat: 1_600_000,
          prixDetail: 2_000_000,
          prixGros: 1_900_000,
        },
      })
    ).id;
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: acc.id,
          nom: 'Coque Hot 40',
          prixAchat: 10_000,
          prixDetail: 30_000,
          prixGros: 25_000,
        },
      })
    ).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 30 },
        { produitId: coqueId, boutiqueId: d.boutiqueB.id, quantite: 5 },
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
              prixAchat: 1_600_000,
            },
          })
        ).id,
      );
    }
    client = (
      await prisma.client.create({
        data: {
          commerceId,
          nom: 'Fatoumata Camara',
          telephone: `+22462${base.slice(-7)}`,
          typePiece: 'CNI',
          numeroPiece: 'GN-77',
          adresse: 'Matoto, Conakry',
          plafondCredit: 5_000_000,
        },
      })
    ).id;
    vendeurA = await connecter(app, d.vendeurA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('3. un troc réduit le prix du neuf et ajoute l’ancien appareil au stock occasion', async () => {
    const trocArticle = randomUUID();
    const contenu = vente([ligneTel(articles[0])], 1_300_000, {
      clientId: client,
      troc: {
        id: randomUUID(),
        articleId: trocArticle,
        produitId: telephoneId,
        imei: imei(),
        etatEcran: 'BON',
        etatBatterie: 'MOYEN',
        etatBoitier: 'BON',
        fonctionne: true,
        note: '',
        valeurProposee: 700_000,
        valeurRetenue: 700_000,
        destination: 'A_REVENDRE',
        prixRevente: 1_100_000,
        autorisation: null,
      },
    });
    expect((await operation(vendeurA, d.boutiqueA.id, 'VENTE_ENREGISTRER', contenu)).statut).toBe(
      'APPLIQUEE',
    );
    expect(await prisma.vente.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      total: 1_300_000n,
      reprise: 700_000n,
    });
    expect(await prisma.article.findUniqueOrThrow({ where: { id: trocArticle } })).toMatchObject({
      statut: 'EN_STOCK',
      origine: 'TROC',
      prixRevente: 1_100_000n,
      boutiqueId: d.boutiqueA.id,
    });
  });

  it('4. une tranche encaissée met à jour le solde et produit un reçu', async () => {
    creditId = randomUUID();
    const contenu = vente([ligneTel(articles[1])], 500_000, {
      clientId: client,
      credit: {
        id: creditId,
        apport: 500_000,
        nombreTranches: 3,
        frequence: 'MENSUELLE',
        premiereEcheance: '2026-02-10',
        garantId: null,
        echeanceIds: [randomUUID(), randomUUID(), randomUUID()],
      },
    });
    expect((await operation(vendeurA, d.boutiqueA.id, 'VENTE_ENREGISTRER', contenu)).statut).toBe(
      'APPLIQUEE',
    );
    const encaissementId = randomUUID();
    expect(
      (
        await operation(vendeurA, d.boutiqueA.id, 'CREDIT_ENCAISSER', {
          id: encaissementId,
          creditId,
          dateEncaissement: new Date().toISOString(),
          moyen: 'ORANGE_MONEY',
          montant: 500_000,
          reference: 'OM-55',
          caisseId: null,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    const credit = await prisma.credit.findUniqueOrThrow({ where: { id: creditId } });
    expect(credit.montantRestant).toBe(1_000_000n);
    // Reçu (même calcul que sur l'appareil) : montant versé et solde restant.
    const recu = lignesRecuEncaissement(
      {
        commerce: d.commerce.nom,
        boutique: { nom: 'Boutique A', adresse: null, telephone: null },
        numeroVente: contenu.numero,
        client: 'Fatoumata Camara',
        date: new Date().toISOString(),
        montant: 500_000,
        moyen: 'ORANGE_MONEY',
        reference: 'OM-55',
        restant: Number(credit.montantRestant),
        prochaine: { date: '2026-02-10', reste: 0 },
        encaissePar: 'Vendeur',
        monnaie: 'GNF',
        fuseau: 'Africa/Conakry',
      },
      80,
    )
      .map((l) => l.texte)
      .join('\n');
    expect(recu).toMatch(/Versé +500 000 GNF/);
    expect(recu).toMatch(/Reste dû +1 000 000 GNF/);
  });

  it('5. un client en retard reçoit un rappel automatique', async () => {
    // La tranche du 10 février a été payée (critère 4) ; le 20 mars, celle du 10 mars ne l'est pas.
    const r = await app
      .get(RappelsService)
      .executer(new Date('2026-03-20T09:00:00Z'), [d.commerce.id]);
    expect(r.rappels).toBe(1);
    const message = await prisma.message.findFirstOrThrow({
      where: { commerceId: d.commerce.id, clientId: client, type: 'RETARD_ECHEANCE' },
    });
    expect(message.contenu).toMatch(/Fatoumata Camara/);
    expect(message.destinataire).toMatch(/^\+224/);
  });

  it('6. un transfert déplace le stock une fois la réception confirmée', async () => {
    const id = randomUUID();
    const ligneCoque = randomUUID();
    expect(
      (
        await operation(proprietaire, d.boutiqueA.id, 'TRANSFERT_ENVOYER', {
          id,
          numero: `TR-${base}`,
          boutiqueArriveeId: d.boutiqueB.id,
          note: null,
          lignes: [
            { id: randomUUID(), produitId: telephoneId, articleId: articles[2], quantite: 1 },
            { id: ligneCoque, produitId: coqueId, articleId: null, quantite: 10 },
          ],
        })
      ).statut,
    ).toBe('APPLIQUEE');
    // Envoyé : sorti du départ, pas encore entré à l'arrivée.
    expect(await stock(coqueId, d.boutiqueA.id)).toBe(20);
    expect(await stock(coqueId, d.boutiqueB.id)).toBe(5);
    expect(
      (
        await operation(vendeurB, d.boutiqueB.id, 'TRANSFERT_RECEVOIR', {
          transfertId: id,
          recuLe: new Date().toISOString(),
          quantites: [{ ligneId: ligneCoque, quantite: 10 }],
          articlesRecus: [articles[2]],
          note: null,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    expect(await stock(coqueId, d.boutiqueB.id)).toBe(15);
    expect(await stock(telephoneId, d.boutiqueB.id)).toBe(1);
    expect(await prisma.article.findUniqueOrThrow({ where: { id: articles[2] } })).toMatchObject({
      statut: 'EN_STOCK',
      boutiqueId: d.boutiqueB.id,
    });
  });

  it('7. le propriétaire voit les chiffres de toutes ses boutiques sur un seul écran', async () => {
    expect(
      (
        await operation(
          vendeurB,
          d.boutiqueB.id,
          'VENTE_ENREGISTRER',
          vente(
            [
              {
                id: randomUUID(),
                produitId: coqueId,
                articleId: null,
                quantite: 2,
                tarif: 'DETAIL',
                prixUnitaire: 30_000,
              },
            ],
            60_000,
          ),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    const { body } = await http()
      .get('/api/tableau')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const nomme = (id: string) =>
      body.boutiques.find((b: { boutiqueId: string }) => b.boutiqueId === id);
    expect(nomme(d.boutiqueA.id)).toMatchObject({ chiffreAffaires: 4_000_000, creditsEnRetard: 1 });
    expect(nomme(d.boutiqueB.id)).toMatchObject({ chiffreAffaires: 60_000 });
    expect(body.total.chiffreAffaires).toBe(4_060_000);
    expect(body.total.derniereSync).not.toBeNull();
  });

  it('appareil perdu : sur un nouvel appareil, tout revient du serveur', async () => {
    // Nouvel appareil du vendeur de A (nouvelle session) : instantané complet.
    const nouveau = await connecter(app, d.vendeurA.identifiant);
    expect(nouveau.appareilId).not.toBe(vendeurA.appareilId);
    const { body } = await http()
      .get('/api/sync/instantane')
      .auth(nouveau.jetonAcces, bearer)
      .expect(200);
    expect(body.donnees.vente.length).toBeGreaterThanOrEqual(2);
    expect(body.donnees.credit.map((c: { id: string }) => c.id)).toContain(creditId);
    expect(body.donnees.encaissement).toHaveLength(1);
    expect(body.donnees.troc).toHaveLength(1);
    expect(
      body.donnees.stock.find((s: { produitId: string }) => s.produitId === coqueId)?.quantite,
    ).toBe(20);
    // L'ancien appareil, déconnecté à distance par le propriétaire, ne voit plus rien.
    await http()
      .post(`/api/appareils/${vendeurA.appareilId}/deconnexion`)
      .auth(proprietaire.jetonAcces, bearer)
      .expect(204);
    await http().get('/api/sync/instantane').auth(vendeurA.jetonAcces, bearer).expect(401);
  });
});
