import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
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

/**
 * Volume du cahier des charges côté serveur : 10 000 produits et 20 000 IMEI dans
 * une boutique. Premier remplissage d'un appareil (instantané), vente synchronisée,
 * tableau de bord. Les durées mesurées sont affichées.
 */
describe('Performance du serveur (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let proprietaire: SessionTest;
  const produits: string[] = [];
  const articles: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-6);

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    for (let i = 0; i < 10_000; i++) produits.push(randomUUID());
    await prisma.produit.createMany({
      data: produits.map((id, i) => ({
        id,
        commerceId,
        type: 'TELEPHONE' as const,
        categorieId: categorie.id,
        nom: `Téléphone ${i}`,
        prixAchat: 900_000,
        prixDetail: 1_000_000,
        prixGros: 950_000,
      })),
    });
    await prisma.stock.createMany({
      data: produits.map((produitId) => ({ produitId, boutiqueId: d.boutiqueA.id, quantite: 2 })),
    });
    for (let j = 0; j < 20_000; j++) articles.push(randomUUID());
    for (let lot = 0; lot < 20_000; lot += 5_000) {
      await prisma.article.createMany({
        data: articles.slice(lot, lot + 5_000).map((id, k) => ({
          id,
          commerceId,
          produitId: produits[(lot + k) % 10_000],
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`8${base}${String(lot + k).padStart(7, '0')}`),
          prixAchat: 900_000,
        })),
      });
    }
    vendeur = await connecter(app, d.vendeurA.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
  }, 300_000);

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  }, 120_000);

  const chrono = async <T>(travail: () => Promise<T>) => {
    const debut = performance.now();
    const resultat = await travail();
    return { resultat, ms: Math.round(performance.now() - debut) };
  };

  it('premier remplissage d’un appareil, vente et tableau de bord', async () => {
    const instantane = await chrono(() =>
      http().get('/api/sync/instantane').auth(vendeur.jetonAcces, bearer).expect(200),
    );
    expect(instantane.resultat.body.donnees.produit).toHaveLength(10_000);
    expect(instantane.resultat.body.donnees.article).toHaveLength(20_000);

    const vente = await chrono(() =>
      http()
        .post('/api/sync/operations')
        .auth(vendeur.jetonAcces, bearer)
        .send({
          operations: [
            {
              id: randomUUID(),
              type: 'VENTE_ENREGISTRER',
              boutiqueId: d.boutiqueA.id,
              faiteLe: new Date().toISOString(),
              contenu: {
                id: randomUUID(),
                numero: `PERF-${base}`,
                dateVente: new Date().toISOString(),
                clientId: null,
                lignes: [
                  {
                    id: randomUUID(),
                    produitId: produits[4242],
                    articleId: articles[4242],
                    quantite: 1,
                    tarif: 'DETAIL',
                    prixUnitaire: 1_000_000,
                  },
                ],
                remise: 0,
                paiements: [
                  { id: randomUUID(), moyen: 'ESPECES', montant: 1_000_000, reference: null },
                ],
                autorisationRemise: null,
              },
            },
          ],
        })
        .expect(200),
    );
    expect(vente.resultat.body.resultats[0].statut).toBe('APPLIQUEE');

    const tableau = await chrono(() =>
      http().get('/api/tableau').auth(proprietaire.jetonAcces, bearer).expect(200),
    );
    expect(tableau.resultat.body.total.stockAchat).toBeGreaterThan(0);

    const json = JSON.stringify(instantane.resultat.body);
    const taille = Math.round(json.length / 1024);
    // Caddy compresse les réponses (encode zstd gzip) : ce qui passe réellement sur le réseau.
    const compresse = Math.round(gzipSync(json).length / 1024);
    const resume = `Instantané : ${instantane.ms} ms (${taille} Ko, ${compresse} Ko compressé) · vente : ${vente.ms} ms · tableau : ${tableau.ms} ms`;
    // PERF_SORTIE=fichier : durées écrites pour le compte rendu (la console des tests est muette).
    if (process.env.PERF_SORTIE) writeFileSync(process.env.PERF_SORTIE, resume);
    expect(instantane.ms).toBeLessThan(15_000);
    expect(vente.ms).toBeLessThan(2_000);
    expect(tableau.ms).toBeLessThan(3_000);
    expect(compresse).toBeLessThan(taille / 5);
  }, 120_000);
});
