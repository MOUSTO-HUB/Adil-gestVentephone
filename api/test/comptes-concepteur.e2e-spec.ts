import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { codeTotp, pasDe } from '../src/plateforme/totp.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { demarrerApplication, prismaDe } from './outils.js';

const MOT_DE_PASSE_A = 'Concepteur-A-2026';

describe('Comptes des concepteurs et double authentification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jetonA: string;
  let idB: string;
  let provisoireB: string;
  let jetonB: string;
  let secretB: string;
  const suffixe = randomUUID().slice(0, 8);
  const idA = randomUUID();
  const identifiantB = `aide-${suffixe}`;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const connexion = (identifiant: string, motDePasse: string, code?: string) =>
    http().post('/api/plateforme/connexion').send({ identifiant, motDePasse, code });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    await prisma.concepteur.create({
      data: {
        id: idA,
        nom: 'Concepteur A',
        identifiant: `principal-${suffixe}`,
        motDePasseHash: await hash(MOT_DE_PASSE_A),
      },
    });
    jetonA = (await connexion(`principal-${suffixe}`, MOT_DE_PASSE_A).expect(200)).body.jeton;
  });

  afterAll(async () => {
    await prisma.concepteur.deleteMany({
      where: {
        OR: [{ id: idA }, { identifiant: { contains: suffixe } }],
      },
    });
    await app.close();
  });

  it('création d’un concepteur : mot de passe provisoire, à changer avant tout', async () => {
    const { body } = await http()
      .post('/api/plateforme/concepteurs')
      .auth(jetonA, bearer)
      .send({ nom: ' Aïssata Camara ', identifiant: identifiantB })
      .expect(201);
    idB = body.id;
    provisoireB = body.motDePasseProvisoire;
    expect(provisoireB.length).toBeGreaterThanOrEqual(12);
    await http()
      .post('/api/plateforme/concepteurs')
      .auth(jetonA, bearer)
      .send({ nom: 'Doublon', identifiant: identifiantB })
      .expect(409);

    const session = await connexion(identifiantB, provisoireB).expect(200);
    jetonB = session.body.jeton;
    expect(session.body.concepteur).toMatchObject({
      nom: 'Aïssata Camara',
      doitChangerMotDePasse: true,
    });
    await http().get('/api/plateforme/commerces').auth(jetonB, bearer).expect(403);
    await http()
      .put('/api/plateforme/moi/mot-de-passe')
      .auth(jetonB, bearer)
      .send({ actuel: provisoireB, nouveau: 'court1' })
      .expect(400);
    await http()
      .put('/api/plateforme/moi/mot-de-passe')
      .auth(jetonB, bearer)
      .send({ actuel: 'faux', nouveau: 'Aissata-2026-ok' })
      .expect(401);
    await http()
      .put('/api/plateforme/moi/mot-de-passe')
      .auth(jetonB, bearer)
      .send({ actuel: provisoireB, nouveau: 'Aissata-2026-ok' })
      .expect(204);
    await http().get('/api/plateforme/commerces').auth(jetonB, bearer).expect(200);

    const { body: liste } = await http().get('/api/plateforme/concepteurs').auth(jetonA, bearer);
    expect(liste.find((c: { id: string }) => c.id === idB)).toMatchObject({
      identifiant: identifiantB,
      actif: true,
      doubleAuth: false,
      moi: false,
    });
    expect(liste.find((c: { id: string }) => c.id === idA)).toMatchObject({ moi: true });
  });

  it('double authentification : QR code, activation, code exigé à la connexion', async () => {
    const { body } = await http()
      .post('/api/plateforme/moi/double-auth/preparer')
      .auth(jetonB, bearer)
      .expect(200);
    expect(body.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(body.adresse).toMatch(/^otpauth:\/\/totp\//);
    secretB = body.secret.replace(/\s/g, '');
    // Le secret est chiffré en base.
    const enBase = await prisma.concepteur.findUniqueOrThrow({ where: { id: idB } });
    expect(enBase.totpSecret).not.toContain(secretB);

    await http()
      .post('/api/plateforme/moi/double-auth/activer')
      .auth(jetonB, bearer)
      .send({ code: '000000' })
      .expect(400);
    await http()
      .post('/api/plateforme/moi/double-auth/activer')
      .auth(jetonB, bearer)
      .send({ code: codeTotp(secretB, pasDe()) })
      .expect(204);

    const sansCode = await connexion(identifiantB, 'Aissata-2026-ok').expect(200);
    expect(sansCode.body).toEqual({ doubleAuth: true });
    await connexion(identifiantB, 'Aissata-2026-ok', '123456').expect(401);
    // Le code déjà utilisé à l'activation est refusé ; le suivant est accepté.
    const utilise = (await prisma.concepteur.findUniqueOrThrow({ where: { id: idB } }))
      .totpDernierPas!;
    await connexion(identifiantB, 'Aissata-2026-ok', codeTotp(secretB, utilise)).expect(401);
    const avecCode = await connexion(
      identifiantB,
      'Aissata-2026-ok',
      codeTotp(secretB, Math.max(utilise + 1, pasDe())),
    ).expect(200);
    expect(avecCode.body.concepteur).toMatchObject({ doubleAuth: true });
  });

  it('un concepteur aide un autre : mot de passe provisoire et double authentification retirée', async () => {
    await http()
      .post(`/api/plateforme/concepteurs/${idA}/recuperation`)
      .auth(jetonA, bearer)
      .send({ retirerDoubleAuth: false })
      .expect(400);
    const { body } = await http()
      .post(`/api/plateforme/concepteurs/${idB}/recuperation`)
      .auth(jetonA, bearer)
      .send({ retirerDoubleAuth: true })
      .expect(200);
    await connexion(identifiantB, 'Aissata-2026-ok').expect(401);
    const session = await connexion(identifiantB, body.motDePasseProvisoire).expect(200);
    expect(session.body.concepteur).toMatchObject({
      doitChangerMotDePasse: true,
      doubleAuth: false,
    });
  });

  it('désactivation puis suppression du compte seul ; identifiant réutilisable', async () => {
    await http()
      .patch(`/api/plateforme/concepteurs/${idB}`)
      .auth(jetonA, bearer)
      .send({ actif: false })
      .expect(204);
    const provisoire = (
      await http()
        .post(`/api/plateforme/concepteurs/${idB}/recuperation`)
        .auth(jetonA, bearer)
        .send({ retirerDoubleAuth: false })
        .expect(200)
    ).body.motDePasseProvisoire;
    await connexion(identifiantB, provisoire).expect(401);

    await http().delete(`/api/plateforme/concepteurs/${idA}`).auth(jetonA, bearer).expect(400);
    await http().delete(`/api/plateforme/concepteurs/${idB}`).auth(jetonA, bearer).expect(204);
    const supprime = await prisma.concepteur.findUniqueOrThrow({ where: { id: idB } });
    expect(supprime).toMatchObject({ actif: false, nom: 'Aïssata Camara' });
    expect(supprime.supprimeLe).not.toBeNull();
    const { body: liste } = await http().get('/api/plateforme/concepteurs').auth(jetonA, bearer);
    expect(liste.some((c: { id: string }) => c.id === idB)).toBe(false);
    await http()
      .post('/api/plateforme/concepteurs')
      .auth(jetonA, bearer)
      .send({ nom: 'Nouvelle Aïssata', identifiant: identifiantB })
      .expect(201);
  });
});
