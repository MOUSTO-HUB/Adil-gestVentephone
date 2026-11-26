import { generateKeyPairSync, type KeyObject, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configurerApplication } from '../src/app.setup.js';
import { Role } from '../src/generated/prisma/enums.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const MOT_DE_PASSE = 'Mot-De-Passe-Test-1';

/** Clé d'un appareil de test (ECDSA P-256), comme celle que garde chaque appareil. */
export interface CleAppareil {
  privee: KeyObject;
  publique: { kty: string; crv: string; x: string; y: string };
}

export function nouvelleCleAppareil(): CleAppareil {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privee: privateKey, publique: { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! } };
}

/** Appareil des tests : le même pour tous les comptes (autorisé d'office comme premier appareil). */
export const CLE_APPAREIL_TEST = nouvelleCleAppareil();

/** Preuve de l'appareil : défi du serveur signé par sa clé. */
export async function preuveAppareil(app: INestApplication<App>, cle = CLE_APPAREIL_TEST) {
  const { body } = await request(app.getHttpServer()).post('/api/auth/defi').expect(200);
  const signature = sign('sha256', Buffer.from(body.defi as string), {
    key: cle.privee,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return { cle: cle.publique, defi: body.defi as string, signature };
}

export async function demarrerApplication(): Promise<INestApplication<App>> {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication<INestApplication<App>>();
  configurerApplication(app);
  await app.init();
  return app;
}

/**
 * Commerce de test isolé : deux boutiques (A, B), un propriétaire, un gérant de A,
 * un vendeur de A et un vendeur de B. Identifiants uniques à chaque exécution.
 */
export async function creerCommerce(prisma: PrismaService) {
  const suffixe = randomUUID().slice(0, 8);
  const commerce = await prisma.commerce.create({ data: { nom: `Commerce test ${suffixe}` } });
  const boutiqueA = await prisma.boutique.create({
    data: { commerceId: commerce.id, nom: 'Boutique A', prefixe: 'A' },
  });
  const boutiqueB = await prisma.boutique.create({
    data: { commerceId: commerce.id, nom: 'Boutique B', prefixe: 'B' },
  });
  const motDePasseHash = await hash(MOT_DE_PASSE);
  const compte = (nom: string, role: Role, boutiqueIds: string[]) =>
    prisma.utilisateur.create({
      data: {
        commerceId: commerce.id,
        nom,
        identifiant: `${nom}-${suffixe}`,
        motDePasseHash,
        role,
        boutiques: { create: boutiqueIds.map((boutiqueId) => ({ boutiqueId })) },
      },
    });
  return {
    commerce,
    boutiqueA,
    boutiqueB,
    proprietaire: await compte('proprietaire', Role.PROPRIETAIRE, []),
    gerantA: await compte('gerant', Role.GERANT, [boutiqueA.id]),
    vendeurA: await compte('vendeur-a', Role.VENDEUR, [boutiqueA.id]),
    vendeurB: await compte('vendeur-b', Role.VENDEUR, [boutiqueB.id]),
  };
}

/** Supprime un commerce de test et tout ce qui en dépend. */
export async function supprimerCommerce(prisma: PrismaService, commerceId: string) {
  await prisma.journalAudit.deleteMany({ where: { commerceId } });
  await prisma.certificatAppareil.deleteMany({ where: { commerceId } });
  await prisma.codeAppareil.deleteMany({ where: { commerceId } });
  await prisma.demandeMotDePasse.deleteMany({ where: { commerceId } });
  await prisma.message.deleteMany({ where: { commerceId } });
  await prisma.modeleMessage.deleteMany({ where: { commerceId } });
  await prisma.operationSync.deleteMany({ where: { commerceId } });
  await prisma.changement.deleteMany({ where: { commerceId } });
  await prisma.mouvementStock.deleteMany({ where: { commerceId } });
  await prisma.troc.deleteMany({ where: { commerceId } });
  await prisma.encaissement.deleteMany({ where: { commerceId } });
  await prisma.echeance.deleteMany({ where: { credit: { commerceId } } });
  await prisma.credit.deleteMany({ where: { commerceId } });
  await prisma.grilleReprise.deleteMany({ where: { commerceId } });
  await prisma.imeiSignale.deleteMany({ where: { commerceId } });
  await prisma.ligneRetour.deleteMany({ where: { retour: { commerceId } } });
  await prisma.retour.deleteMany({ where: { commerceId } });
  await prisma.paiement.deleteMany({ where: { vente: { commerceId } } });
  await prisma.ligneVente.deleteMany({ where: { vente: { commerceId } } });
  await prisma.vente.deleteMany({ where: { commerceId } });
  await prisma.depense.deleteMany({ where: { commerceId } });
  await prisma.caisse.deleteMany({ where: { commerceId } });
  await prisma.ligneInventaire.deleteMany({ where: { inventaire: { commerceId } } });
  await prisma.inventaire.deleteMany({ where: { commerceId } });
  await prisma.ligneTransfert.deleteMany({ where: { transfert: { commerceId } } });
  await prisma.transfert.deleteMany({ where: { commerceId } });
  await prisma.article.deleteMany({ where: { commerceId } });
  await prisma.ligneAchat.deleteMany({ where: { achat: { commerceId } } });
  await prisma.achat.deleteMany({ where: { commerceId } });
  await prisma.stock.deleteMany({ where: { produit: { commerceId } } });
  await prisma.compatibilite.deleteMany({ where: { accessoire: { commerceId } } });
  await prisma.prixBoutique.deleteMany({ where: { produit: { commerceId } } });
  await prisma.produit.deleteMany({ where: { commerceId } });
  await prisma.modele.deleteMany({ where: { commerceId } });
  await prisma.marque.deleteMany({ where: { commerceId } });
  await prisma.categorie.deleteMany({ where: { commerceId } });
  await prisma.garant.deleteMany({ where: { client: { commerceId } } });
  await prisma.client.deleteMany({ where: { commerceId } });
  await prisma.fournisseur.deleteMany({ where: { commerceId } });
  await prisma.appareil.deleteMany({ where: { commerceId } });
  await prisma.utilisateurBoutique.deleteMany({ where: { utilisateur: { commerceId } } });
  await prisma.utilisateur.deleteMany({ where: { commerceId } });
  await prisma.boutique.deleteMany({ where: { commerceId } });
  await prisma.rapportArchive.deleteMany({ where: { commerceId } });
  await prisma.paiementAbonnement.deleteMany({ where: { commerceId } });
  await prisma.commerce.delete({ where: { id: commerceId } });
}

export interface SessionTest {
  jetonAcces: string;
  jetonRafraichissement: string;
  appareilId: string;
}

export async function connecter(
  app: INestApplication<App>,
  identifiant: string,
  motDePasse = MOT_DE_PASSE,
): Promise<SessionTest> {
  // Preuve d'abord : deux requêtes supertest ne s'ouvrent pas en même temps sur le serveur.
  const preuve = await preuveAppareil(app);
  const reponse = await request(app.getHttpServer())
    .post('/api/auth/connexion')
    .send({
      identifiant,
      motDePasse,
      appareil: { nom: 'Téléphone de test', plateforme: 'android' },
      preuve,
    })
    .expect(200);
  return reponse.body as SessionTest;
}

export const prismaDe = (app: INestApplication) => app.get(PrismaService);
