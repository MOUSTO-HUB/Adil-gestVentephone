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

describe('Boutiques multiples et employés (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerant: SessionTest;
  let vendeurB: SessionTest;
  let boutiqueC: string;
  let employeId: string;
  let identifiant: string;
  let motDePasse: string;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const suffixe = randomUUID().slice(0, 6);

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeurB = await connecter(app, d.vendeurB.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  const moi = async (s: SessionTest) =>
    (await http().get('/api/auth/moi').auth(s.jetonAcces, bearer).expect(200)).body as {
      boutiques: { id: string; nom: string }[];
    };

  it('le propriétaire crée autant de boutiques qu’il veut (préfixe unique)', async () => {
    await http()
      .post('/api/boutiques')
      .auth(gerant.jetonAcces, bearer)
      .send({ nom: 'Boutique C', prefixe: 'BC' })
      .expect(403);
    const { body } = await http()
      .post('/api/boutiques')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ nom: 'Boutique C', prefixe: 'bc', adresse: 'Kaloum' })
      .expect(201);
    boutiqueC = body.id;
    expect(body.prefixe).toBe('BC');
    await http()
      .post('/api/boutiques')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ nom: 'Doublon', prefixe: 'BC' })
      .expect(409);
    await http()
      .patch(`/api/boutiques/${boutiqueC}`)
      .auth(proprietaire.jetonAcces, bearer)
      .send({ nom: 'Boutique Kaloum' })
      .expect(204);
    expect((await moi(proprietaire)).boutiques.map((b) => b.nom)).toContain('Boutique Kaloum');
    // Le gérant de A ne la voit pas.
    expect((await moi(gerant)).boutiques.map((b) => b.id)).toEqual([d.boutiqueA.id]);
  });

  it('employé créé, rattaché à une boutique ; le gérant voit l’équipe de ses boutiques', async () => {
    identifiant = `aissatou-${suffixe}`;
    await http()
      .post('/api/employes')
      .auth(gerant.jetonAcces, bearer)
      .send({ nom: 'Aïssatou', identifiant, role: 'VENDEUR', boutiqueIds: [d.boutiqueA.id] })
      .expect(403);
    await http()
      .post('/api/employes')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ nom: 'Aïssatou', identifiant, role: 'VENDEUR', boutiqueIds: [] })
      .expect(400);
    const { body } = await http()
      .post('/api/employes')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ nom: 'Aïssatou', identifiant, role: 'VENDEUR', boutiqueIds: [d.boutiqueA.id] })
      .expect(201);
    employeId = body.id;
    motDePasse = body.motDePasse;
    const session = await connecter(app, identifiant, motDePasse);
    expect((await moi(session)).boutiques.map((b) => b.id)).toEqual([d.boutiqueA.id]);

    const equipeGerant = await http()
      .get('/api/employes')
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    const noms = equipeGerant.body.map((e: { identifiant: string }) => e.identifiant);
    expect(noms).toContain(identifiant);
    expect(noms).not.toContain(d.vendeurB.identifiant);
    expect(noms).not.toContain(d.proprietaire.identifiant);
    const tous = await http()
      .get('/api/employes')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    expect(tous.body.length).toBeGreaterThanOrEqual(5);
    await http().get('/api/employes').auth(vendeurB.jetonAcces, bearer).expect(403);
  });

  it('changement de boutiques : effet immédiat, l’appareil reprend ses données', async () => {
    const session = await connecter(app, identifiant, motDePasse);
    const avant = await http()
      .get('/api/sync/changements?curseur=0')
      .auth(session.jetonAcces, bearer)
      .expect(200);
    expect(avant.body.boutiques).toEqual([d.boutiqueA.id]);
    await http()
      .patch(`/api/employes/${employeId}`)
      .auth(proprietaire.jetonAcces, bearer)
      .send({ boutiqueIds: [boutiqueC, d.boutiqueB.id], role: 'GERANT' })
      .expect(204);
    expect((await moi(session)).boutiques.map((b) => b.id).sort()).toEqual(
      [boutiqueC, d.boutiqueB.id].sort(),
    );
    const apres = await http()
      .get('/api/sync/instantane')
      .auth(session.jetonAcces, bearer)
      .expect(200);
    expect(apres.body.boutiques).toEqual([boutiqueC, d.boutiqueB.id].sort());
    // Plus rien de la boutique A.
    await http()
      .get(`/api/boutiques/${d.boutiqueA.id}`)
      .auth(session.jetonAcces, bearer)
      .expect(403);
  });

  it('désactivé : déconnecté partout ; mot de passe réinitialisé ; propriétaire intouchable', async () => {
    const session = await connecter(app, identifiant, motDePasse);
    const { body: acces } = await http()
      .post(`/api/employes/${employeId}/mot-de-passe`)
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(401);
    const nouvelle = await connecter(app, identifiant, acces.motDePasse);
    await http()
      .patch(`/api/employes/${employeId}`)
      .auth(proprietaire.jetonAcces, bearer)
      .send({ actif: false })
      .expect(204);
    await http().get('/api/auth/moi').auth(nouvelle.jetonAcces, bearer).expect(401);
    await http()
      .post('/api/auth/connexion')
      .send({
        identifiant,
        motDePasse: acces.motDePasse,
        appareil: { nom: 'T', plateforme: 'web' },
      })
      .expect((r) => expect([401, 403]).toContain(r.status));
    await http()
      .patch(`/api/employes/${d.proprietaire.id}`)
      .auth(proprietaire.jetonAcces, bearer)
      .send({ actif: false })
      .expect(403);
    expect(
      await prisma.journalAudit.count({
        where: { commerceId: d.commerce.id, action: { in: ['EMPLOYE_CREE', 'EMPLOYE_MODIFIE'] } },
      }),
    ).toBeGreaterThanOrEqual(3);
  });
});
