import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  connecter,
  creerCommerce,
  demarrerApplication,
  prismaDe,
  supprimerCommerce,
} from './outils.js';

const MOT_DE_PASSE_CONCEPTEUR = 'Concepteur-Test-2026';

/** Mot de passe oublié : demande publique, notification et traitement par le concepteur. */
describe('Mot de passe oublié des commerçants (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let jeton: string;
  // Le contact du concepteur est un réglage global : remis tel quel après le test.
  let ancienContact: { valeur: string } | null = null;
  const ancienPrefixe = process.env.REDIS_PREFIXE;
  const suffixe = randomUUID().slice(0, 8);
  const concepteurId = randomUUID();
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const demander = (corps: object) =>
    http().post('/api/aide/mot-de-passe-oublie').send(corps).expect(202);

  beforeAll(async () => {
    // Compteurs Redis propres à ce fichier (limite de 5 demandes par heure et par IP).
    process.env.REDIS_PREFIXE = `test-mdp-${suffixe}`;
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    ancienContact = await prisma.reglagePlateforme.findUnique({
      where: { cle: 'contact-concepteur' },
    });
    await prisma.concepteur.create({
      data: {
        id: concepteurId,
        nom: 'Concepteur de test',
        identifiant: `concepteur-${suffixe}`,
        motDePasseHash: await hash(MOT_DE_PASSE_CONCEPTEUR),
      },
    });
    jeton = (
      await http()
        .post('/api/plateforme/connexion')
        .send({ identifiant: `concepteur-${suffixe}`, motDePasse: MOT_DE_PASSE_CONCEPTEUR })
        .expect(200)
    ).body.jeton;
  });

  afterAll(async () => {
    if (ancienContact) {
      await prisma.reglagePlateforme.update({
        where: { cle: 'contact-concepteur' },
        data: { valeur: ancienContact.valeur },
      });
    } else {
      await prisma.reglagePlateforme.deleteMany({ where: { cle: 'contact-concepteur' } });
    }
    await supprimerCommerce(prisma, d.commerce.id);
    await prisma.concepteur.delete({ where: { id: concepteurId } });
    await app.close();
    if (ancienPrefixe === undefined) delete process.env.REDIS_PREFIXE;
    else process.env.REDIS_PREFIXE = ancienPrefixe;
  });

  it('même réponse pour un compte inconnu, sans demande enregistrée', async () => {
    const inconnu = await demander({ identifiant: `personne-${suffixe}` });
    const connu = await demander({
      identifiant: d.proprietaire.identifiant.toUpperCase(),
      contact: '+224620112233',
      message: 'Boutique de Madina',
    });
    expect(inconnu.body).toEqual(connu.body);
    // Deuxième demande du même compte : la demande en attente est mise à jour, pas doublée.
    await demander({ identifiant: d.proprietaire.identifiant, contact: '+224620445566' });
    const demandes = await prisma.demandeMotDePasse.findMany({
      where: { commerceId: d.commerce.id },
    });
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatchObject({ statut: 'EN_ATTENTE', contact: '+224620445566' });
  });

  it('le concepteur est notifié et donne un nouveau mot de passe provisoire', async () => {
    const { body: compte } = await http()
      .get('/api/plateforme/demandes/compte')
      .auth(jeton, bearer)
      .expect(200);
    expect(compte.enAttente).toBeGreaterThanOrEqual(1);
    const { body: demandes } = await http()
      .get('/api/plateforme/demandes')
      .auth(jeton, bearer)
      .expect(200);
    const demande = demandes.find(
      (x: { utilisateur: { identifiant: string } | null }) =>
        x.utilisateur?.identifiant === d.proprietaire.identifiant,
    );
    expect(demande).toMatchObject({ statut: 'EN_ATTENTE', commerce: { id: d.commerce.id } });

    // Un commerçant connecté n'ouvre pas les demandes.
    const proprietaire = await connecter(app, d.proprietaire.identifiant);
    await http().get('/api/plateforme/demandes').auth(proprietaire.jetonAcces, bearer).expect(401);

    const { body: acces } = await http()
      .post(`/api/plateforme/demandes/${demande.id}/mot-de-passe`)
      .auth(jeton, bearer)
      .expect(200);
    expect(acces).toMatchObject({
      identifiant: d.proprietaire.identifiant,
      contact: '+224620445566',
    });
    await connecter(app, d.proprietaire.identifiant, acces.motDePasse);
    await http()
      .post(`/api/plateforme/demandes/${demande.id}/mot-de-passe`)
      .auth(jeton, bearer)
      .expect(409);
    const journal = await prisma.journalAudit.findMany({
      where: {
        commerceId: d.commerce.id,
        action: { in: ['MOT_DE_PASSE_DEMANDE', 'PLATEFORME_MOT_DE_PASSE'] },
      },
    });
    expect(journal.map((j) => j.action).sort()).toEqual([
      'MOT_DE_PASSE_DEMANDE',
      'PLATEFORME_MOT_DE_PASSE',
    ]);
  });

  it('contact du concepteur : modifié dans son espace, lu sans connexion', async () => {
    await http()
      .put('/api/plateforme/contact')
      .auth(jeton, bearer)
      .send({ nom: 'Service GestVente', telephone: '+224620000000', whatsapp: '', email: 'x' })
      .expect(400);
    await http()
      .put('/api/plateforme/contact')
      .auth(jeton, bearer)
      .send({
        nom: 'Service GestVente',
        telephone: '+224620000000',
        whatsapp: '+224620000001',
        email: null,
      })
      .expect(200);
    const { body } = await http().get('/api/aide/contact').expect(200);
    expect(body).toEqual({
      nom: 'Service GestVente',
      telephone: '+224620000000',
      whatsapp: '+224620000001',
      email: null,
    });
  });

  it('demandes limitées par adresse IP', async () => {
    for (let i = 0; i < 2; i++) await demander({ identifiant: `x-${i}` });
    await http().post('/api/aide/mot-de-passe-oublie').send({ identifiant: 'encore' }).expect(429);
  });
});
