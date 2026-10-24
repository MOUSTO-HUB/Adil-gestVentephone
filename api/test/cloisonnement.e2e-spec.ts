import { randomUUID } from 'node:crypto';
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
 * Cloisonnement des commerces : le propriétaire d'un commerce appelle chaque route
 * qui prend un identifiant avec ceux d'un autre commerce (client, vente, crédit,
 * troc, transfert, employé, boutique, produit, IMEI…) ; aucune ne doit réussir.
 */
describe('Cloisonnement entre commerces (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let moi: Awaited<ReturnType<typeof creerCommerce>>;
  let autre: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  const etrangers: string[] = [];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    moi = await creerCommerce(prisma);
    autre = await creerCommerce(prisma);
    proprietaire = await connecter(app, moi.proprietaire.identifiant);

    // Un élément de chaque sorte dans l'autre commerce.
    const commerceId = autre.commerce.id;
    const boutiqueId = autre.boutiqueA.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const produit = await prisma.produit.create({
      data: {
        commerceId,
        type: 'TELEPHONE',
        categorieId: categorie.id,
        nom: 'Étranger',
        prixAchat: 1,
        prixDetail: 2,
        prixGros: 2,
      },
    });
    const imei = completerImei(`77${String(Date.now()).slice(-12)}`);
    const article = await prisma.article.create({
      data: { commerceId, produitId: produit.id, boutiqueId, imei, prixAchat: 1 },
    });
    const client = await prisma.client.create({
      data: { commerceId, nom: 'Étranger', telephone: '+224620999999' },
    });
    const vente = await prisma.vente.create({
      data: {
        commerceId,
        boutiqueId,
        numero: `X-${randomUUID().slice(0, 6)}`,
        clientId: client.id,
        vendeurId: autre.vendeurA.id,
        sousTotal: 2,
        total: 2,
        montantPaye: 0,
        mode: 'CREDIT',
        lignes: {
          create: [
            {
              produitId: produit.id,
              articleId: article.id,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 2,
              total: 2,
              prixAchat: 1,
            },
          ],
        },
      },
    });
    const credit = await prisma.credit.create({
      data: {
        commerceId,
        boutiqueId,
        venteId: vente.id,
        clientId: client.id,
        montantTotal: 2,
        apport: 0,
        montantFinance: 2,
        montantRestant: 2,
        nombreTranches: 1,
        frequence: 'MENSUELLE',
        premiereEcheance: new Date(),
      },
    });
    const troc = await prisma.troc.create({
      data: {
        commerceId,
        boutiqueId,
        clientId: client.id,
        imei,
        etatEcran: 'BON',
        etatBatterie: 'BON',
        etatBoitier: 'BON',
        fonctionne: true,
        etatGlobal: 'BON',
        photoCles: ['00000000-0000-4000-8000-000000000000.jpg'],
        valeurProposee: 1,
        valeurRetenue: 1,
      },
    });
    const transfert = await prisma.transfert.create({
      data: {
        commerceId,
        numero: `TR-${randomUUID().slice(0, 6)}`,
        boutiqueDepartId: boutiqueId,
        boutiqueArriveeId: autre.boutiqueB.id,
      },
    });
    const depense = await prisma.depense.create({
      data: {
        commerceId,
        boutiqueId,
        categorie: 'AUTRE',
        libelle: 'Étrangère',
        montant: 1,
        moyen: 'ESPECES',
        creeParId: autre.vendeurA.id,
      },
    });
    const fournisseur = await prisma.fournisseur.create({ data: { commerceId, nom: 'Étranger' } });
    const appareil = await prisma.appareil.create({
      data: {
        commerceId,
        utilisateurId: autre.vendeurA.id,
        nom: 'Téléphone',
        plateforme: 'android',
      },
    });
    etrangers.push(
      produit.id,
      article.id,
      imei,
      client.id,
      vente.id,
      credit.id,
      troc.id,
      transfert.id,
      depense.id,
      fournisseur.id,
      appareil.id,
      autre.vendeurA.id,
      autre.gerantA.id,
      boutiqueId,
    );
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, autre.commerce.id);
    await supprimerCommerce(prisma, moi.commerce.id);
    await app.close();
  });

  it('aucune route ne donne accès aux données d’un autre commerce', async () => {
    const doc = (await http().get('/api/docs-json').expect(200)).body as {
      paths: Record<string, Record<string, unknown>>;
    };
    const fuites: string[] = [];
    let appels = 0;
    for (const [chemin, methodes] of Object.entries(doc.paths)) {
      if (!/\{[^}]+\}/.test(chemin)) continue;
      // Routes publiques (photos du catalogue, factures) et espace concepteur : jetons à part.
      if (chemin.startsWith('/api/photos') || chemin.startsWith('/api/f/')) continue;
      if (chemin.startsWith('/api/plateforme')) continue;
      for (const methode of Object.keys(methodes)) {
        for (const id of etrangers) {
          const url = chemin.replace(/\{[^}]+\}/g, id);
          const reponse = await http()
            [methode as 'get' | 'post' | 'put' | 'patch' | 'delete'](url)
            .auth(proprietaire.jetonAcces, { type: 'bearer' })
            .send({});
          appels++;
          if (reponse.status < 300)
            fuites.push(`${methode.toUpperCase()} ${url} → ${reponse.status}`);
        }
      }
    }
    expect(appels).toBeGreaterThan(100);
    expect(fuites).toEqual([]);
  }, 180_000);
});
