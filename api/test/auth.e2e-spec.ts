import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  connecter,
  creerCommerce,
  demarrerApplication,
  MOT_DE_PASSE,
  prismaDe,
  supprimerCommerce,
} from './outils.js';

describe('Authentification, rôles et appareils (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let donnees: Awaited<ReturnType<typeof creerCommerce>>;
  let autreCommerce: Awaited<ReturnType<typeof creerCommerce>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    donnees = await creerCommerce(prisma);
    autreCommerce = await creerCommerce(prisma);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, donnees.commerce.id);
    await supprimerCommerce(prisma, autreCommerce.commerce.id);
    await app.close();
  });

  describe('connexion', () => {
    it('ouvre une session et donne le profil, le commerce et les boutiques', async () => {
      // Identifiant insensible à la casse et aux espaces.
      const session = await connecter(app, ` ${donnees.vendeurA.identifiant.toUpperCase()} `);
      const moi = await http()
        .get('/api/auth/moi')
        .auth(session.jetonAcces, { type: 'bearer' })
        .expect(200);
      expect(moi.body).toMatchObject({
        id: donnees.vendeurA.id,
        role: 'VENDEUR',
        appareilId: session.appareilId,
        pinDefini: false,
        commerce: { id: donnees.commerce.id, monnaie: 'GNF', indicatif: '+224' },
        boutiques: [{ id: donnees.boutiqueA.id, nom: 'Boutique A' }],
      });

      const journal = await prisma.journalAudit.findFirst({
        where: { utilisateurId: donnees.vendeurA.id, action: 'CONNEXION' },
      });
      expect(journal?.appareilId).toBe(session.appareilId);
    });

    it('le propriétaire voit toutes les boutiques', async () => {
      const session = await connecter(app, donnees.proprietaire.identifiant);
      const moi = await http()
        .get('/api/auth/moi')
        .auth(session.jetonAcces, { type: 'bearer' })
        .expect(200);
      expect(moi.body.boutiques.map((b: { nom: string }) => b.nom)).toEqual([
        'Boutique A',
        'Boutique B',
      ]);
    });

    it('refuse un mauvais mot de passe ou un identifiant inconnu avec le même message', async () => {
      const appareil = { nom: 'Test', plateforme: 'web' };
      const mauvais = await http()
        .post('/api/auth/connexion')
        .send({ identifiant: donnees.gerantA.identifiant, motDePasse: 'faux', appareil })
        .expect(401);
      const inconnu = await http()
        .post('/api/auth/connexion')
        .send({ identifiant: 'personne-inconnue', motDePasse: 'faux', appareil })
        .expect(401);
      expect(mauvais.body.message).toBe(inconnu.body.message);
    });

    it('refuse un compte désactivé', async () => {
      await prisma.utilisateur.update({
        where: { id: donnees.vendeurB.id },
        data: { actif: false },
      });
      await http()
        .post('/api/auth/connexion')
        .send({
          identifiant: donnees.vendeurB.identifiant,
          motDePasse: MOT_DE_PASSE,
          appareil: { nom: 'Test', plateforme: 'web' },
        })
        .expect(403);
      await prisma.utilisateur.update({
        where: { id: donnees.vendeurB.id },
        data: { actif: true },
      });
    });

    it('valide les entrées', async () => {
      await http()
        .post('/api/auth/connexion')
        .send({ identifiant: 'x', motDePasse: 'y', appareil: { nom: 'Test', plateforme: 'nokia' } })
        .expect(400);
    });

    it('bloque après 10 essais incorrects sur un même compte', async () => {
      const corps = {
        identifiant: autreCommerce.vendeurA.identifiant,
        motDePasse: 'faux',
        appareil: { nom: 'Test', plateforme: 'web' },
      };
      for (let i = 0; i < 10; i++) await http().post('/api/auth/connexion').send(corps).expect(401);
      const bloque = await http().post('/api/auth/connexion').send(corps).expect(429);
      expect(bloque.body.reessayerDansS).toBeGreaterThan(0);
    });
  });

  describe('jetons', () => {
    it('le jeton de rafraîchissement tourne ; un ancien jeton réutilisé ferme la session', async () => {
      const session = await connecter(app, donnees.gerantA.identifiant);
      const nouvelle = await http()
        .post('/api/auth/rafraichir')
        .send({ jetonRafraichissement: session.jetonRafraichissement })
        .expect(200);
      expect(nouvelle.body.appareilId).toBe(session.appareilId);

      // L'ancien jeton revient (vol probable) : refus, et la session de l'appareil est fermée.
      await http()
        .post('/api/auth/rafraichir')
        .send({ jetonRafraichissement: session.jetonRafraichissement })
        .expect(401);
      await http()
        .post('/api/auth/rafraichir')
        .send({ jetonRafraichissement: nouvelle.body.jetonRafraichissement })
        .expect(401);
      await http()
        .get('/api/auth/moi')
        .auth(nouvelle.body.jetonAcces, { type: 'bearer' })
        .expect(401);
    });

    it('refuse un jeton mal formé', async () => {
      await http()
        .post('/api/auth/rafraichir')
        .send({ jetonRafraichissement: 'pas-un-vrai-jeton' })
        .expect(401);
    });

    it('la déconnexion coupe aussitôt le jeton d’accès et le rafraîchissement', async () => {
      const session = await connecter(app, donnees.vendeurA.identifiant);
      await http()
        .post('/api/auth/deconnexion')
        .auth(session.jetonAcces, { type: 'bearer' })
        .expect(204);
      await http().get('/api/auth/moi').auth(session.jetonAcces, { type: 'bearer' }).expect(401);
      await http()
        .post('/api/auth/rafraichir')
        .send({ jetonRafraichissement: session.jetonRafraichissement })
        .expect(401);
    });
  });

  describe('déconnexion à distance', () => {
    it('le gérant voit et déconnecte un appareil d’un vendeur de sa boutique', async () => {
      const gerant = await connecter(app, donnees.gerantA.identifiant);
      const vendeur = await connecter(app, donnees.vendeurA.identifiant);
      const proprietaire = await connecter(app, donnees.proprietaire.identifiant);

      const liste = await http()
        .get('/api/appareils')
        .auth(gerant.jetonAcces, { type: 'bearer' })
        .expect(200);
      const ids = liste.body.map((a: { id: string }) => a.id);
      expect(ids).toContain(vendeur.appareilId);
      expect(ids).toContain(gerant.appareilId);
      expect(ids).not.toContain(proprietaire.appareilId);

      await http()
        .post(`/api/appareils/${vendeur.appareilId}/deconnexion`)
        .auth(gerant.jetonAcces, { type: 'bearer' })
        .expect(204);
      await http().get('/api/auth/moi').auth(vendeur.jetonAcces, { type: 'bearer' }).expect(401);

      const journal = await prisma.journalAudit.findFirst({
        where: { action: 'DECONNEXION_A_DISTANCE', entiteId: vendeur.appareilId },
      });
      expect(journal?.utilisateurId).toBe(donnees.gerantA.id);
    });

    it("le gérant ne peut pas déconnecter le propriétaire ni un vendeur d'une autre boutique", async () => {
      const gerant = await connecter(app, donnees.gerantA.identifiant);
      const proprietaire = await connecter(app, donnees.proprietaire.identifiant);
      await http()
        .post(`/api/appareils/${proprietaire.appareilId}/deconnexion`)
        .auth(gerant.jetonAcces, { type: 'bearer' })
        .expect(403);
      await http()
        .post(`/api/utilisateurs/${donnees.vendeurB.id}/deconnexion`)
        .auth(gerant.jetonAcces, { type: 'bearer' })
        .expect(403);
    });

    it('un vendeur ne gère pas les appareils', async () => {
      const vendeur = await connecter(app, donnees.vendeurA.identifiant);
      await http().get('/api/appareils').auth(vendeur.jetonAcces, { type: 'bearer' }).expect(403);
    });

    it('le propriétaire déconnecte tous les appareils d’un employé', async () => {
      const proprietaire = await connecter(app, donnees.proprietaire.identifiant);
      const premier = await connecter(app, donnees.vendeurB.identifiant);
      const second = await connecter(app, donnees.vendeurB.identifiant);
      const reponse = await http()
        .post(`/api/utilisateurs/${donnees.vendeurB.id}/deconnexion`)
        .auth(proprietaire.jetonAcces, { type: 'bearer' })
        .expect(200);
      expect(reponse.body.appareils).toBeGreaterThanOrEqual(2);
      for (const session of [premier, second]) {
        await http().get('/api/auth/moi').auth(session.jetonAcces, { type: 'bearer' }).expect(401);
      }
    });

    it("personne n'agit sur un autre commerce", async () => {
      const proprietaire = await connecter(app, donnees.proprietaire.identifiant);
      const etranger = await connecter(app, autreCommerce.gerantA.identifiant);
      await http()
        .post(`/api/appareils/${etranger.appareilId}/deconnexion`)
        .auth(proprietaire.jetonAcces, { type: 'bearer' })
        .expect(404);
      await http()
        .post(`/api/utilisateurs/${autreCommerce.gerantA.id}/deconnexion`)
        .auth(proprietaire.jetonAcces, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('boutiques', () => {
    it("un vendeur n'accède qu'à sa boutique ; le propriétaire à toutes les siennes", async () => {
      const vendeur = await connecter(app, donnees.vendeurA.identifiant);
      const proprietaire = await connecter(app, donnees.proprietaire.identifiant);
      await http()
        .get(`/api/boutiques/${donnees.boutiqueA.id}`)
        .auth(vendeur.jetonAcces, { type: 'bearer' })
        .expect(200);
      await http()
        .get(`/api/boutiques/${donnees.boutiqueB.id}`)
        .auth(vendeur.jetonAcces, { type: 'bearer' })
        .expect(403);
      await http()
        .get(`/api/boutiques/${donnees.boutiqueB.id}`)
        .auth(proprietaire.jetonAcces, { type: 'bearer' })
        .expect(200);
      await http()
        .get(`/api/boutiques/${autreCommerce.boutiqueA.id}`)
        .auth(proprietaire.jetonAcces, { type: 'bearer' })
        .expect(404);
    });
  });

  describe('code PIN', () => {
    it('définition, vérification et changement avec le mot de passe', async () => {
      const session = await connecter(app, donnees.gerantA.identifiant);
      const auth = { type: 'bearer' as const };

      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '1234' })
        .expect(400);
      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '2580' })
        .expect(204);

      const faux = await http()
        .post('/api/auth/pin/verification')
        .auth(session.jetonAcces, auth)
        .send({ pin: '0000' })
        .expect(200);
      expect(faux.body.valide).toBe(false);
      const bon = await http()
        .post('/api/auth/pin/verification')
        .auth(session.jetonAcces, auth)
        .send({ pin: '2580' })
        .expect(200);
      expect(bon.body.valide).toBe(true);

      // Changer un code déjà défini exige le mot de passe.
      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '7391' })
        .expect(400);
      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '7391', motDePasse: 'faux' })
        .expect(401);
      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '7391', motDePasse: MOT_DE_PASSE })
        .expect(204);
    });

    it('limite les essais de code PIN', async () => {
      const session = await connecter(app, donnees.proprietaire.identifiant);
      const auth = { type: 'bearer' as const };
      await http()
        .put('/api/auth/pin')
        .auth(session.jetonAcces, auth)
        .send({ pin: '2580' })
        .expect(204);
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/auth/pin/verification')
          .auth(session.jetonAcces, auth)
          .send({ pin: '0000' })
          .expect(200);
      }
      await http()
        .post('/api/auth/pin/verification')
        .auth(session.jetonAcces, auth)
        .send({ pin: '2580' })
        .expect(429);
    });
  });
});
