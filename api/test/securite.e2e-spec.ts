import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { demarrerApplication } from './outils.js';

/**
 * Inventaire des routes (documentation OpenAPI) : toute route exige un jeton,
 * sauf celles listées ici, avec leur justification. Une nouvelle route publique
 * doit être ajoutée à cette liste.
 */
const ROUTES_PUBLIQUES: Record<string, string> = {
  'GET /api/sante': 'supervision et test de connexion de l’application',
  'POST /api/auth/connexion': 'connexion (limitée par IP et par identifiant)',
  'POST /api/auth/rafraichir': 'renouvellement par jeton de rafraichissement',
  'GET /api/photos/{nom}': 'photos du catalogue (sans donnée personnelle), nom aléatoire',
  'GET /api/f/{code}':
    'facture envoyée au client par SMS ou WhatsApp, code aléatoire de 10 caractères',
};

describe('Sécurité des routes (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await demarrerApplication();
  });

  afterAll(async () => {
    await app.close();
  });

  it('toute route non publique refuse une requête sans jeton', async () => {
    const doc = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const paths = doc.body.paths as Record<string, Record<string, unknown>>;
    const routes = Object.entries(paths).flatMap(([chemin, methodes]) =>
      Object.keys(methodes).map((methode) => ({ methode: methode.toUpperCase(), chemin })),
    );
    expect(routes.length).toBeGreaterThan(5);

    for (const { methode, chemin } of routes) {
      const cle = `${methode} ${chemin}`;
      if (cle in ROUTES_PUBLIQUES) continue;
      const url = chemin.replace(/\{[^}]+\}/g, randomUUID());
      const reponse = await request(app.getHttpServer())[
        methode.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
      ](url);
      expect({ route: cle, statut: reponse.status }).toEqual({ route: cle, statut: 401 });
    }
  });

  it('les routes publiques déclarées existent', async () => {
    const doc = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    for (const cle of Object.keys(ROUTES_PUBLIQUES)) {
      const [methode, chemin] = cle.split(' ');
      expect(doc.body.paths[chemin]?.[methode.toLowerCase()]).toBeDefined();
    }
  });
});
