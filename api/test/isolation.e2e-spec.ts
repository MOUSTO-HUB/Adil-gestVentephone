import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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

interface Operation {
  parameters?: { name: string; in: string }[];
  requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
}

/**
 * Isolement des boutiques : toute route qui prend une boutique (chemin, requête ou
 * corps) refuse un employé qui n'y est pas rattaché ; sa synchronisation n'en reçoit rien.
 */
describe('Isolement des boutiques sur toutes les routes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeurB: SessionTest;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    vendeurB = await connecter(app, d.vendeurB.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('un employé de B est refusé sur chaque route visant la boutique A', async () => {
    const doc = (await http().get('/api/docs-json').expect(200)).body as {
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    const verifiees: string[] = [];
    for (const [chemin, methodes] of Object.entries(doc.paths)) {
      for (const [methode, op] of Object.entries(methodes)) {
        const params = op.parameters ?? [];
        const ref = Object.values(op.requestBody?.content ?? {})[0]?.schema?.$ref;
        const schema = ref ? doc.components.schemas[ref.split('/').pop()!] : undefined;
        const dansCorps = !!schema?.properties && 'boutiqueId' in schema.properties;
        const dansChemin = params.some((p) => p.in === 'path' && p.name === 'boutiqueId');
        const dansRequete = params.some((p) => p.in === 'query' && p.name === 'boutiqueId');
        if (!dansCorps && !dansChemin && !dansRequete) continue;

        const url =
          chemin.replace('{boutiqueId}', d.boutiqueA.id).replace(/\{[^}]+\}/g, randomUUID()) +
          (dansRequete ? `?boutiqueId=${d.boutiqueA.id}` : '');
        const appel = http()
          [methode as 'get' | 'post' | 'put' | 'patch' | 'delete'](url)
          .auth(vendeurB.jetonAcces, bearer);
        const reponse = await (dansCorps ? appel.send({ boutiqueId: d.boutiqueA.id }) : appel);
        const cle = `${methode.toUpperCase()} ${chemin}`;
        verifiees.push(cle);
        expect({ route: cle, refusee: [403, 404].includes(reponse.status) }).toEqual({
          route: cle,
          refusee: true,
        });
      }
    }
    // Rapports, journal, ventes, boutiques… : l'inventaire n'est pas vide.
    expect(verifiees.length).toBeGreaterThanOrEqual(5);
  });

  it('opérations de synchronisation sur la boutique A : rejetées', async () => {
    const { body } = await http()
      .post('/api/sync/operations')
      .auth(vendeurB.jetonAcces, bearer)
      .send({
        operations: [
          {
            id: randomUUID(),
            type: 'CAISSE_OUVRIR',
            boutiqueId: d.boutiqueA.id,
            faiteLe: new Date().toISOString(),
            contenu: { id: randomUUID(), ouverteLe: new Date().toISOString(), fondInitial: 0 },
          },
        ],
      })
      .expect(200);
    expect(body.resultats[0]).toMatchObject({ statut: 'REJETEE' });
  });

  it('l’instantané et les changements ne contiennent que la boutique B', async () => {
    const categorie = await prisma.categorie.create({
      data: { commerceId: d.commerce.id, nom: 'Coques', type: 'ACCESSOIRE' },
    });
    const produit = await prisma.produit.create({
      data: {
        commerceId: d.commerce.id,
        type: 'ACCESSOIRE',
        categorieId: categorie.id,
        nom: 'Coque',
        prixAchat: 1,
        prixDetail: 2,
        prixGros: 2,
      },
    });
    await prisma.stock.create({
      data: { produitId: produit.id, boutiqueId: d.boutiqueA.id, quantite: 9 },
    });
    await prisma.prixBoutique.create({
      data: { produitId: produit.id, boutiqueId: d.boutiqueA.id, prixDetail: 3 },
    });
    const { body } = await http()
      .get('/api/sync/instantane')
      .auth(vendeurB.jetonAcces, bearer)
      .expect(200);
    expect(body.boutiques).toEqual([d.boutiqueB.id]);
    for (const entite of ['stock', 'prixBoutique', 'vente', 'caisse', 'credit', 'troc']) {
      for (const ligne of body.donnees[entite] as { boutiqueId: string }[]) {
        expect({ entite, boutique: ligne.boutiqueId }).toEqual({
          entite,
          boutique: d.boutiqueB.id,
        });
      }
    }
    // Le catalogue (commun) arrive, sans les prix ni le stock de A.
    expect(body.donnees.produit.some((p: { id: string }) => p.id === produit.id)).toBe(true);
  });
});
