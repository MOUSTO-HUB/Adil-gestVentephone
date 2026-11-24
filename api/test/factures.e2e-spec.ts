import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { VenteSaisie } from '@gestvente/commun';
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

/** Coordonnées du client sur la vente, facture (VENTE_FACTURE) et numéros des bons. */
describe('Factures et numéros des bons de commande (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  let produitId: string;
  let fournisseurId: string;
  const base = String(Date.now()).slice(-8);
  let numero = 0;
  const http = () => request(app.getHttpServer());

  const envoyer = async (session: SessionTest, type: string, contenu: unknown) =>
    (
      await http()
        .post('/api/sync/operations')
        .auth(session.jetonAcces, { type: 'bearer' })
        .send({
          operations: [
            {
              id: randomUUID(),
              type,
              boutiqueId: d.boutiqueA.id,
              faiteLe: new Date().toISOString(),
              contenu,
            },
          ],
        })
        .expect(200)
    ).body.resultats[0] as { statut: string; motif?: string };

  const vendre = async (session: SessionTest, client: Partial<VenteSaisie> = {}) => {
    const contenu: VenteSaisie = {
      id: randomUUID(),
      numero: `FAC-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: null,
      lignes: [
        {
          id: randomUUID(),
          produitId,
          articleId: null,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 100_000,
        },
      ],
      remise: 0,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: 100_000, reference: null }],
      autorisationRemise: null,
      ...client,
    };
    expect((await envoyer(session, 'VENTE_ENREGISTRER', contenu)).statut).toBe('APPLIQUEE');
    return contenu;
  };

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const categorie = await prisma.categorie.create({
      data: { commerceId: d.commerce.id, nom: 'Accessoires', type: 'ACCESSOIRE' },
    });
    produitId = (
      await prisma.produit.create({
        data: {
          commerceId: d.commerce.id,
          type: 'ACCESSOIRE',
          categorieId: categorie.id,
          nom: 'Chargeur rapide',
          prixAchat: 60_000,
          prixDetail: 100_000,
          prixGros: 90_000,
        },
      })
    ).id;
    await prisma.stock.create({
      data: { produitId, boutiqueId: d.boutiqueA.id, quantite: 50 },
    });
    fournisseurId = (
      await prisma.fournisseur.create({
        data: { commerceId: d.commerce.id, nom: 'Madina Télécom' },
      })
    ).id;
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('garde les coordonnées facultatives du client saisies à la vente', async () => {
    const vente = await vendre(vendeur, {
      nomClient: 'Aïssatou Bah',
      contactClient: '+224622334455',
      adresseClient: null,
    });
    const enBase = await prisma.vente.findUniqueOrThrow({ where: { id: vente.id } });
    expect(enBase).toMatchObject({
      nomClient: 'Aïssatou Bah',
      contactClient: '+224622334455',
      adresseClient: null,
      factureEmise: false,
    });
  });

  it('facture : nom, contact et adresse obligatoires, puis modifiables', async () => {
    const vente = await vendre(vendeur);
    const incomplete = await envoyer(vendeur, 'VENTE_FACTURE', {
      venteId: vente.id,
      nomClient: 'Ousmane Sow',
      contactClient: '+224623000000',
      adresseClient: '',
    });
    expect(incomplete.statut).toBe('REJETEE');

    const facture = {
      venteId: vente.id,
      nomClient: 'Ousmane Sow',
      contactClient: '+224623000000',
      adresseClient: 'Kaloum, Conakry',
    };
    expect((await envoyer(vendeur, 'VENTE_FACTURE', facture)).statut).toBe('APPLIQUEE');
    expect(
      (await envoyer(vendeur, 'VENTE_FACTURE', { ...facture, adresseClient: 'Ratoma, Conakry' }))
        .statut,
    ).toBe('APPLIQUEE');
    const enBase = await prisma.vente.findUniqueOrThrow({ where: { id: vente.id } });
    expect(enBase).toMatchObject({ factureEmise: true, adresseClient: 'Ratoma, Conakry' });
  });

  it('un vendeur ne modifie pas la facture d’une vente du gérant', async () => {
    const vente = await vendre(gerant);
    const resultat = await envoyer(vendeur, 'VENTE_FACTURE', {
      venteId: vente.id,
      nomClient: 'Kadiatou Barry',
      contactClient: '+224624000000',
      adresseClient: 'Dixinn',
    });
    expect(resultat.statut).toBe('REJETEE');
  });

  it('deux bons hors ligne au même numéro : le second prend le numéro suivant', async () => {
    const bon = () => ({
      id: randomUUID(),
      fournisseurId,
      numero: 'BCGE-20260001',
      dateAchat: '2026-11-24',
      note: null,
      lignes: [{ id: randomUUID(), produitId, quantite: 2, prixAchat: 60_000 }],
    });
    const premier = bon();
    const second = bon();
    expect((await envoyer(gerant, 'ACHAT_ENREGISTRER', premier)).statut).toBe('APPLIQUEE');
    expect((await envoyer(gerant, 'ACHAT_ENREGISTRER', second)).statut).toBe('APPLIQUEE');
    const numeros = await prisma.achat.findMany({
      where: { id: { in: [premier.id, second.id] } },
      select: { id: true, numero: true },
    });
    expect(numeros.find((a) => a.id === premier.id)?.numero).toBe('BCGE-20260001');
    expect(numeros.find((a) => a.id === second.id)?.numero).toBe('BCGE-20260002');
    // Le numéro d'un bon existant ne change pas à la modification.
    expect(
      (await envoyer(gerant, 'ACHAT_ENREGISTRER', { ...second, numero: 'BCGE-20260001' })).statut,
    ).toBe('APPLIQUEE');
    const corrige = await prisma.achat.findUniqueOrThrow({ where: { id: second.id } });
    expect(corrige.numero).toBe('BCGE-20260002');
  });
});
