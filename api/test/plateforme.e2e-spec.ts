import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ACCESSOIRES_REFERENCE, TELEPHONES_REFERENCE } from '../src/catalogue/reference.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { connecter, demarrerApplication, prismaDe, supprimerCommerce } from './outils.js';

const MOT_DE_PASSE_CONCEPTEUR = 'Concepteur-Test-2026';
const PRODUITS_REFERENCE =
  TELEPHONES_REFERENCE.reduce((t, x) => t + x.variantes.length, 0) + ACCESSOIRES_REFERENCE.length;

describe('Espace concepteur (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jeton: string;
  let commerceId: string;
  let boutiqueId: string;
  let identifiant: string;
  let motDePasse: string;
  const suffixe = randomUUID().slice(0, 8);
  const concepteurId = randomUUID();
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const plateforme = () => ({
    get: (url: string) => http().get(`/api/plateforme${url}`).auth(jeton, bearer),
    post: (url: string, corps: object = {}) =>
      http().post(`/api/plateforme${url}`).auth(jeton, bearer).send(corps),
    patch: (url: string, corps: object) =>
      http().patch(`/api/plateforme${url}`).auth(jeton, bearer).send(corps),
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    await prisma.concepteur.create({
      data: {
        id: concepteurId,
        nom: 'Concepteur de test',
        identifiant: `concepteur-${suffixe}`,
        motDePasseHash: await hash(MOT_DE_PASSE_CONCEPTEUR),
      },
    });
  });

  afterAll(async () => {
    if (commerceId) await supprimerCommerce(prisma, commerceId);
    await prisma.concepteur.delete({ where: { id: concepteurId } });
    await app.close();
  });

  it('connexion du concepteur : jeton distinct de ceux des commerçants', async () => {
    await http()
      .post('/api/plateforme/connexion')
      .send({ identifiant: `concepteur-${suffixe}`, motDePasse: 'faux' })
      .expect(401);
    const { body } = await http()
      .post('/api/plateforme/connexion')
      .send({ identifiant: `CONCEPTEUR-${suffixe}`, motDePasse: MOT_DE_PASSE_CONCEPTEUR })
      .expect(200);
    jeton = body.jeton;
    expect(body.concepteur.nom).toBe('Concepteur de test');
    // Le jeton du concepteur n'ouvre pas les données des commerces.
    await http().get('/api/sync/instantane').auth(jeton, bearer).expect(401);
    await http().get('/api/plateforme/commerces').expect(401);
  });

  it('nouveau commerçant : boutique, propriétaire et catalogue de base sans photo', async () => {
    identifiant = `proprio-${suffixe}`;
    const { body } = await plateforme()
      .post('/commerces', {
        commerce: `Phone Center ${suffixe}`,
        telephone: '+224620123456',
        boutique: 'Phone Center Kaloum',
        prefixe: 'kal',
        adresse: 'Kaloum, Conakry',
        proprietaire: 'Mariama Sow',
        identifiant,
      })
      .expect(201);
    commerceId = body.commerceId;
    motDePasse = body.motDePasse;
    expect(body.produits).toBe(PRODUITS_REFERENCE);
    const produits = await prisma.produit.findMany({ where: { commerceId } });
    expect(produits).toHaveLength(PRODUITS_REFERENCE);
    expect(produits.every((p) => p.photoCle === null)).toBe(true);
    expect(produits.map((p) => p.nom)).toEqual(
      expect.arrayContaining([
        'iPhone 13 Pro 128 Go',
        'Samsung S22 Ultra 256 Go',
        'Tecno Camon 15 64 Go',
        'Anticasse iPhone 12',
        'Casque Bluetooth P47',
      ]),
    );
    const anticasse = produits.find((p) => p.nom === 'Anticasse iPhone 12')!;
    const compatibles = await prisma.compatibilite.findMany({
      where: { accessoireId: anticasse.id },
      include: { modele: true },
    });
    expect(compatibles.map((c) => c.modele.nom)).toEqual(['12']);

    // Le propriétaire se connecte avec le mot de passe provisoire.
    const session = await connecter(app, identifiant, motDePasse);
    const profil = await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(200);
    boutiqueId = profil.body.boutiques[0].id;
    expect(profil.body.boutiques[0].prefixe).toBe('KAL');

    const { body: liste } = await plateforme().get('/commerces').expect(200);
    expect(liste.find((c: { id: string }) => c.id === commerceId)).toMatchObject({
      boutiques: 1,
      produits: PRODUITS_REFERENCE,
      proprietaire: { nom: 'Mariama Sow' },
    });
  });

  it('catalogue de base réinstallé : rien n’est remplacé ni dupliqué', async () => {
    await prisma.produit.updateMany({
      where: { commerceId, nom: 'iPhone 13 Pro 128 Go' },
      data: { prixDetail: 5_250_000 },
    });
    await prisma.produit.deleteMany({ where: { commerceId, nom: 'Casque Bluetooth P47' } });
    const { body } = await plateforme().post(`/commerces/${commerceId}/catalogue`).expect(200);
    expect(body).toMatchObject({ produits: 1, modeles: 0, marques: 0 });
    const iphone = await prisma.produit.findFirstOrThrow({
      where: { commerceId, nom: 'iPhone 13 Pro 128 Go' },
    });
    expect(iphone.prixDetail).toBe(5_250_000n);
    expect(await prisma.produit.count({ where: { commerceId } })).toBe(PRODUITS_REFERENCE);
  });

  it('boutique verrouillée puis retirée : plus d’opération ; restaurée : tout revient', async () => {
    const { body: nouvelle } = await plateforme()
      .post(`/commerces/${commerceId}/boutiques`, { nom: 'Phone Center Madina', prefixe: 'MAD' })
      .expect(201);
    await plateforme()
      .post(`/commerces/${commerceId}/boutiques`, { nom: 'Doublon', prefixe: 'mad' })
      .expect(409);

    await plateforme().patch(`/boutiques/${boutiqueId}`, { verrouillee: true }).expect(204);
    const session = await connecter(app, identifiant, motDePasse);
    const profil = await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(200);
    expect(profil.body.boutiques.map((b: { id: string }) => b.id)).toEqual([nouvelle.id]);
    const { body: lot } = await http()
      .post('/api/sync/operations')
      .auth(session.jetonAcces, bearer)
      .send({
        operations: [
          {
            id: randomUUID(),
            type: 'STOCK_SEUIL',
            boutiqueId,
            faiteLe: new Date().toISOString(),
            contenu: { produitId: randomUUID(), seuilMinimum: 2 },
          },
        ],
      })
      .expect(200);
    expect(lot.resultats[0]).toMatchObject({
      statut: 'REJETEE',
      motif: expect.stringMatching(/verrouillée/),
    });
    await http()
      .post('/api/ventes/autorisations-remise')
      .auth(session.jetonAcces, bearer)
      .send({ boutiqueId, identifiant: 'x', pin: '1234', pourcentage: 10 })
      .expect(403);

    await plateforme().patch(`/boutiques/${boutiqueId}`, { verrouillee: false }).expect(204);
    await plateforme().patch(`/boutiques/${nouvelle.id}`, { supprimee: true }).expect(204);
    const apres = await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(200);
    expect(apres.body.boutiques.map((b: { id: string }) => b.id)).toEqual([boutiqueId]);
    await plateforme().patch(`/boutiques/${nouvelle.id}`, { supprimee: false }).expect(204);
    expect(
      (await prisma.boutique.findUniqueOrThrow({ where: { id: nouvelle.id } })).supprimeeLe,
    ).toBeNull();
  });

  it('commerce suspendu : sessions et connexion refusées ; réactivé : accès rétabli', async () => {
    const session = await connecter(app, identifiant, motDePasse);
    await plateforme()
      .post(`/commerces/${commerceId}/statut`, { statut: 'SUSPENDU', motif: 'Abonnement impayé' })
      .expect(204);
    const refus = await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(403);
    expect(refus.body.message).toMatch(/suspendu \(Abonnement impayé\)/);
    await http()
      .post('/api/auth/connexion')
      .send({ identifiant, motDePasse, appareil: { nom: 'Test', plateforme: 'web' } })
      .expect(403);
    await http()
      .post('/api/auth/rafraichir')
      .send({ jetonRafraichissement: session.jetonRafraichissement })
      .expect(403);

    await plateforme().post(`/commerces/${commerceId}/statut`, { statut: 'ACTIF' }).expect(204);
    await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(200);
  });

  it('commerce retiré : masqué de la liste, rien n’est effacé, restaurable', async () => {
    await plateforme().post(`/commerces/${commerceId}/statut`, { statut: 'SUPPRIME' }).expect(204);
    const { body: actifs } = await plateforme().get('/commerces').expect(200);
    expect(actifs.some((c: { id: string }) => c.id === commerceId)).toBe(false);
    const { body: retires } = await plateforme().get('/commerces?statut=SUPPRIME').expect(200);
    expect(retires.some((c: { id: string }) => c.id === commerceId)).toBe(true);
    expect(await prisma.produit.count({ where: { commerceId } })).toBe(PRODUITS_REFERENCE);
    await plateforme().post(`/commerces/${commerceId}/statut`, { statut: 'ACTIF' }).expect(204);

    // Mot de passe oublié du propriétaire : nouveau mot de passe provisoire.
    const { body } = await plateforme()
      .post(`/commerces/${commerceId}/proprietaire/mot-de-passe`)
      .expect(200);
    expect(body.identifiant).toBe(identifiant);
    motDePasse = body.motDePasse;
    await connecter(app, identifiant, motDePasse);
    const journal = await prisma.journalAudit.findMany({
      where: { commerceId, action: { startsWith: 'PLATEFORME_' } },
    });
    expect(journal.length).toBeGreaterThanOrEqual(8);
  });

  it('essai offert à la création ; échéance dépassée : accès et synchronisation coupés, données gardées', async () => {
    const { body: detail } = await plateforme().get(`/commerces/${commerceId}`).expect(200);
    expect(detail.abonnement.etat).toBe('ESSAI');
    expect(detail.abonnement.joursRestants).toBe(30);
    // Deux boutiques ouvertes (la seconde, ajoutée plus haut, est restaurée).
    expect(detail.tarifs).toEqual({ MENSUELLE: 200_000, ANNUELLE: 2_000_000 });

    const session = await connecter(app, identifiant, motDePasse);
    const { body: profil } = await http()
      .get('/api/auth/moi')
      .auth(session.jetonAcces, bearer)
      .expect(200);
    expect(profil.commerce.abonnement.etat).toBe('ESSAI');

    // Échue depuis 3 jours : délai de grâce, l'accès reste ouvert avec un avertissement.
    const ilYa = (jours: number) => new Date(Date.now() - jours * 86_400_000).toISOString();
    await plateforme()
      .patch(`/commerces/${commerceId}/abonnement`, { jusquAu: ilYa(3) })
      .expect(204);
    const { body: grace } = await http()
      .get('/api/auth/moi')
      .auth(session.jetonAcces, bearer)
      .expect(200);
    expect(grace.commerce.abonnement.etat).toBe('EN_GRACE');

    // Échue depuis 10 jours : plus de requête, de synchronisation ni de connexion.
    await plateforme()
      .patch(`/commerces/${commerceId}/abonnement`, { jusquAu: ilYa(10) })
      .expect(204);
    const refus = await http()
      .get('/api/sync/changements?curseur=0')
      .auth(session.jetonAcces, bearer)
      .expect(403);
    expect(refus.body.message).toMatch(/abonnement.*données sont conservées/);
    await http()
      .post('/api/auth/connexion')
      .send({ identifiant, motDePasse, appareil: { nom: 'Test', plateforme: 'web' } })
      .expect(403);
    expect(await prisma.produit.count({ where: { commerceId } })).toBe(PRODUITS_REFERENCE);

    const { body: tableau } = await plateforme().get('/tableau').expect(200);
    expect(tableau.abonnements.EXPIRE).toBeGreaterThanOrEqual(1);
    expect(tableau.echeances.some((e: { id: string }) => e.id === commerceId)).toBe(true);

    // Paiement d'un mois : la nouvelle période part d'aujourd'hui, l'accès revient.
    await plateforme()
      .post(`/commerces/${commerceId}/paiements`, {
        formule: 'MENSUELLE',
        periodes: 1,
        moyen: 'ORANGE_MONEY',
      })
      .expect(400);
    const { body: paye } = await plateforme()
      .post(`/commerces/${commerceId}/paiements`, {
        formule: 'MENSUELLE',
        periodes: 1,
        moyen: 'ORANGE_MONEY',
        reference: 'OM-ABO-1',
      })
      .expect(201);
    expect(paye.montant).toBe(200_000);
    const jours = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
    expect(jours(paye.jusquAu)).toBeGreaterThanOrEqual(28);
    await http()
      .get('/api/sync/changements?curseur=0')
      .auth(session.jetonAcces, bearer)
      .expect(200);

    // Payé d'avance : l'année s'ajoute à l'échéance en cours, rien n'est perdu.
    const { body: annee } = await plateforme()
      .post(`/commerces/${commerceId}/paiements`, {
        formule: 'ANNUELLE',
        periodes: 1,
        moyen: 'ESPECES',
        montant: 1_400_000,
      })
      .expect(201);
    expect(annee.montant).toBe(1_400_000);
    expect(jours(annee.jusquAu) - jours(paye.jusquAu)).toBeGreaterThanOrEqual(365);

    const { body: apres } = await plateforme().get(`/commerces/${commerceId}`).expect(200);
    expect(apres.abonnement.etat).toBe('ACTIF');
    expect(apres.paiements.map((p: { montant: number }) => p.montant)).toEqual([
      1_400_000, 200_000,
    ]);
    const { body: bilan } = await plateforme().get('/tableau').expect(200);
    expect(bilan.encaisse.annee.montant).toBeGreaterThanOrEqual(1_600_000);
    expect(bilan.derniersPaiements[0].commerce).toMatch(/Phone Center/);
    // Le tableau ne donne que des compteurs : aucune vente, aucun client.
    expect(JSON.stringify(bilan)).not.toMatch(/client|vente/i);
  });

  it('jeton du concepteur refusé sur les données des commerces', async () => {
    for (const url of [
      '/api/sync/instantane',
      '/api/tableau/trocs',
      '/api/sync/changements?curseur=0',
      '/api/tableau',
    ]) {
      await http().get(url).auth(jeton, bearer).expect(401);
    }
  });
});
