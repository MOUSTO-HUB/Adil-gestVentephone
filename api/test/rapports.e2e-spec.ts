import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type VenteSaisie } from '@gestvente/commun';
import ExcelJS from 'exceljs';
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

describe('Rapports et journal d’audit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  let vendeurB: SessionTest;
  let telephoneId: string;
  let coqueId: string;
  let chargeurId: string;
  const articles: string[] = [];
  const base = String(Date.now()).slice(-8);
  let numero = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const debut = new Date(Date.now() - 86_400_000).toISOString();
  const fin = new Date(Date.now() + 86_400_000).toISOString();

  const envoyer = async (
    session: SessionTest,
    type: string,
    contenu: unknown,
    boutiqueId = d.boutiqueA.id,
  ) =>
    (
      await http()
        .post('/api/sync/operations')
        .auth(session.jetonAcces, bearer)
        .send({
          operations: [
            { id: randomUUID(), type, boutiqueId, faiteLe: new Date().toISOString(), contenu },
          ],
        })
        .expect(200)
    ).body.resultats[0] as { statut: string; motif?: string };

  const vente = (
    lignes: { produitId: string; articleId?: string; quantite?: number; prixUnitaire: number }[],
    remise = 0,
  ): VenteSaisie => {
    const completes = lignes.map((l) => ({
      id: randomUUID(),
      produitId: l.produitId,
      articleId: l.articleId ?? null,
      quantite: l.quantite ?? 1,
      tarif: 'DETAIL' as const,
      prixUnitaire: l.prixUnitaire,
    }));
    const total = completes.reduce((t, l) => t + l.quantite * l.prixUnitaire, 0) - remise;
    return {
      id: randomUUID(),
      numero: `RAP-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: completes,
      remise,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: total, reference: null }],
      autorisationRemise: null,
    };
  };

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const tel = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const acc = await prisma.categorie.create({
      data: { commerceId, nom: 'Accessoires', type: 'ACCESSOIRE' },
    });
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: tel.id,
          nom: 'Redmi 13',
          prixAchat: 1_200_000,
          prixDetail: 1_500_000,
          prixGros: 1_400_000,
        },
      })
    ).id;
    const accessoire = (nom: string, achat: number, detail: number) =>
      prisma.produit.create({
        data: {
          commerceId,
          type: 'ACCESSOIRE',
          categorieId: acc.id,
          nom,
          prixAchat: achat,
          prixDetail: detail,
          prixGros: detail,
        },
      });
    coqueId = (await accessoire('Coque Redmi 13', 10_000, 30_000)).id;
    chargeurId = (await accessoire('Chargeur 33 W', 20_000, 35_000)).id;
    await prisma.stock.createMany({
      data: [
        { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 3 },
        { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 20 },
        { produitId: chargeurId, boutiqueId: d.boutiqueA.id, quantite: 4 },
      ],
    });
    for (let i = 1; i <= 3; i++) {
      articles.push(
        (
          await prisma.article.create({
            data: {
              commerceId,
              produitId: telephoneId,
              boutiqueId: d.boutiqueA.id,
              imei: completerImei(`38${base}000${i}`),
              // Le deuxième téléphone a coûté plus cher.
              prixAchat: i === 2 ? 1_250_000 : 1_200_000,
            },
          })
        ).id,
      );
    }
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);

    // Vendeur : un téléphone + 2 coques, remise 60 000. Gérant : 3 coques.
    const premiere = vente(
      [
        { produitId: telephoneId, articleId: articles[0], prixUnitaire: 1_500_000 },
        { produitId: coqueId, quantite: 2, prixUnitaire: 30_000 },
      ],
      60_000,
    );
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', premiere)).statut).toBe('APPLIQUEE');
    expect(
      (
        await envoyer(
          gerant,
          'VENTE_ENREGISTRER',
          vente([{ produitId: coqueId, quantite: 3, prixUnitaire: 30_000 }]),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    // Une coque de la première vente revient en stock.
    const ligneCoque = await prisma.ligneVente.findFirstOrThrow({
      where: { venteId: premiere.id, produitId: coqueId },
    });
    expect(
      (
        await envoyer(gerant, 'RETOUR_ENREGISTRER', {
          id: randomUUID(),
          venteId: premiere.id,
          dateRetour: new Date().toISOString(),
          type: 'REMBOURSEMENT',
          etatAppareil: 'INTACT',
          motif: 'Mauvais modèle',
          lignes: [
            {
              id: randomUUID(),
              ligneVenteId: ligneCoque.id,
              quantite: 1,
              destination: 'REMISE_EN_STOCK',
              prixRevente: null,
            },
          ],
          remboursement: { moyen: 'ESPECES', reference: null },
          echange: null,
          autorisation: null,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    expect(
      (
        await envoyer(gerant, 'DEPENSE_ENREGISTRER', {
          id: randomUUID(),
          dateDepense: new Date().toISOString(),
          categorie: 'ELECTRICITE',
          libelle: 'Facture EDG',
          montant: 150_000,
          moyen: 'ESPECES',
          caisseId: null,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    // Une vente dans l'autre boutique (journal du gérant de A : invisible).
    await prisma.stock.create({
      data: { produitId: coqueId, boutiqueId: d.boutiqueB.id, quantite: 5 },
    });
    expect(
      (
        await envoyer(
          vendeurB,
          'VENTE_ENREGISTRER',
          vente([{ produitId: coqueId, prixUnitaire: 30_000 }], 1_000),
          d.boutiqueB.id,
        )
      ).statut,
    ).toBe('APPLIQUEE');
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('ventes : CA net, bénéfice brut, par vendeur et meilleures ventes', async () => {
    const { body } = await http()
      .get('/api/rapports/ventes')
      .query({ boutiqueId: d.boutiqueA.id, du: debut, au: fin })
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    // 1 560 000 − 60 000 + 90 000 ; retour d'une coque : 30 000 × 1 500/1 560 = 28 846.
    expect(body.total).toMatchObject({
      ventes: 1_590_000,
      retours: 28_846,
      chiffreAffaires: 1_561_154,
      cout: 1_200_000 + 50_000 - 10_000,
      nombreVentes: 2,
    });
    expect(body.total.benefice).toBe(1_561_154 - 1_240_000);
    expect(body.parVendeur.map((v: { libelle: string }) => v.libelle)).toEqual([
      d.vendeurA.nom,
      d.gerantA.nom,
    ]);
    expect(body.parProduit[0]).toMatchObject({ libelle: 'Redmi 13', quantite: 1 });
    expect(body.parPeriode).toHaveLength(1);
  });

  it('stock : valeur au prix d’achat (coût réel des IMEI) et de vente, produits sans vente', async () => {
    const { body } = await http()
      .get('/api/rapports/stock')
      .query({ boutiqueId: d.boutiqueA.id, jours: 30 })
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    // Téléphones restants : 1 250 000 + 1 200 000 ; coques : 20 − 5 + 1 = 16 ; chargeurs : 4.
    expect(body.valeurAchat).toBe(2_450_000 + 16 * 10_000 + 4 * 20_000);
    expect(body.valeurVente).toBe(2 * 1_500_000 + 16 * 30_000 + 4 * 35_000);
    expect(body.sansVente.map((p: { nom: string }) => p.nom)).toEqual(['Chargeur 33 W']);
  });

  it('caisse : encaissements par moyen et dépenses par catégorie', async () => {
    const { body } = await http()
      .get('/api/rapports/caisse')
      .query({ boutiqueId: d.boutiqueA.id, du: debut, au: fin })
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(body.encaisse.ESPECES).toBe(1_590_000);
    expect(body.rembourse.ESPECES).toBe(28_846);
    expect(body.depenses).toMatchObject({
      total: 150_000,
      horsCaisse: 150_000,
      parCategorie: [{ categorie: 'ELECTRICITE', montant: 150_000 }],
    });
  });

  it('export Excel ; accès réservé à la gestion de la boutique', async () => {
    const reponse = await http()
      .get('/api/rapports/excel')
      .query({ type: 'ventes', boutiqueId: d.boutiqueA.id, du: debut, au: fin })
      .auth(gerant.jetonAcces, bearer)
      .buffer(true)
      .parse((res, fini) => {
        const morceaux: Buffer[] = [];
        res.on('data', (m: Buffer) => morceaux.push(m));
        res.on('end', () => fini(null, Buffer.concat(morceaux)));
      })
      .expect(200);
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.load(reponse.body as unknown as ArrayBuffer);
    expect(classeur.worksheets.map((f) => f.name)).toEqual(['Périodes', 'Vendeurs', 'Produits']);
    expect(classeur.getWorksheet('Produits')?.getRow(2).getCell(1).value).toBe('Redmi 13');

    await http()
      .get('/api/rapports/ventes')
      .query({ boutiqueId: d.boutiqueA.id, du: debut, au: fin })
      .auth(vendeur.jetonAcces, bearer)
      .expect(403);
    await http()
      .get('/api/rapports/ventes')
      .query({ boutiqueId: d.boutiqueB.id, du: debut, au: fin })
      .auth(gerant.jetonAcces, bearer)
      .expect(403);
    await http()
      .get('/api/rapports/ventes')
      .query({ boutiqueId: d.boutiqueA.id, du: fin, au: debut })
      .auth(gerant.jetonAcces, bearer)
      .expect(400);
  });

  it('journal : filtres, pages, périmètre du gérant', async () => {
    const tout = await http()
      .get('/api/audit')
      .query({ limite: 200 })
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const actions = tout.body.entrees.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(['CONNEXION', 'REMISE_ACCORDEE', 'RETOUR_ENREGISTRE']),
    );
    // Le propriétaire voit la remise de la boutique B ; le gérant de A non.
    const remises = await http()
      .get('/api/audit')
      .query({ actions: 'REMISE_ACCORDEE' })
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(remises.body.entrees.map((e: { boutique: string }) => e.boutique).sort()).toEqual([
      'Boutique A',
      'Boutique B',
    ]);
    const duGerant = await http()
      .get('/api/audit')
      .query({ actions: 'REMISE_ACCORDEE,CONNEXION', limite: 200 })
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    const visibles = duGerant.body.entrees as { boutique: string | null; utilisateur: string }[];
    expect(visibles.some((e) => e.boutique === 'Boutique B')).toBe(false);
    expect(visibles.some((e) => e.utilisateur === d.vendeurB.nom)).toBe(false);
    expect(visibles.some((e) => e.utilisateur === d.vendeurA.nom)).toBe(true);

    // Pages de 2 entrées, sans doublon.
    const premiere = await http()
      .get('/api/audit')
      .query({ limite: 2 })
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(premiere.body.entrees).toHaveLength(2);
    const seconde = await http()
      .get('/api/audit')
      .query({ limite: 2, avant: premiere.body.suivant })
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const ids = [...premiere.body.entrees, ...seconde.body.entrees].map(
      (e: { id: string }) => e.id,
    );
    expect(new Set(ids).size).toBe(4);

    const personnel = await http()
      .get('/api/audit/utilisateurs')
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(personnel.body.map((u: { nom: string }) => u.nom).sort()).toEqual(
      [d.gerantA.nom, d.vendeurA.nom].sort(),
    );
    await http().get('/api/audit').auth(vendeur.jetonAcces, bearer).expect(403);
  });
});
