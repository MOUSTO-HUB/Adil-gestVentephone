import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei } from '@gestvente/commun';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { RappelsService } from '../src/credits/rappels.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  connecter,
  creerCommerce,
  demarrerApplication,
  prismaDe,
  type SessionTest,
  supprimerCommerce,
} from './outils.js';

describe('Rappels et pénalités (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let rappels: RappelsService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let proprietaire: SessionTest;
  let creditId: string;
  let clientId: string;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);

  /** Passage de la tâche quotidienne à 9 h (Conakry = UTC) le jour donné, sur ce commerce. */
  const passer = (jour: string) => rappels.executer(new Date(`${jour}T09:00:00Z`), [d.commerce.id]);
  const messages = () =>
    prisma.message.findMany({ where: { commerceId: d.commerce.id }, orderBy: { creeLe: 'asc' } });
  const tranches = () =>
    prisma.echeance.findMany({ where: { creditId }, orderBy: { numero: 'asc' } });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    rappels = app.get(RappelsService);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Smartphones', type: 'TELEPHONE' },
    });
    const produit = await prisma.produit.create({
      data: {
        commerceId,
        type: 'TELEPHONE',
        categorieId: categorie.id,
        nom: 'Tecno Camon 30',
        prixAchat: 1_500_000,
        prixDetail: 2_000_000,
        prixGros: 1_900_000,
      },
    });
    await prisma.stock.create({
      data: { produitId: produit.id, boutiqueId: d.boutiqueA.id, quantite: 1 },
    });
    const article = await prisma.article.create({
      data: {
        commerceId,
        produitId: produit.id,
        boutiqueId: d.boutiqueA.id,
        imei: completerImei(`88${base}0001`),
        prixAchat: 1_500_000,
      },
    });
    clientId = (
      await prisma.client.create({
        data: {
          commerceId,
          nom: 'Hawa Sylla',
          telephone: `+22462${base.slice(-7)}`,
          typePiece: 'CNI',
          numeroPiece: 'GN-9',
          adresse: 'Ratoma',
          plafondCredit: 5_000_000,
        },
      })
    ).id;
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    creditId = randomUUID();
    const { body } = await http()
      .post('/api/sync/operations')
      .auth(vendeur.jetonAcces, bearer)
      .send({
        operations: [
          {
            id: randomUUID(),
            type: 'VENTE_ENREGISTRER',
            boutiqueId: d.boutiqueA.id,
            faiteLe: new Date().toISOString(),
            contenu: {
              id: randomUUID(),
              numero: `RAP-${base}-1`,
              dateVente: new Date().toISOString(),
              clientId,
              lignes: [
                {
                  id: randomUUID(),
                  produitId: produit.id,
                  articleId: article.id,
                  quantite: 1,
                  tarif: 'DETAIL',
                  prixUnitaire: 2_000_000,
                },
              ],
              remise: 0,
              paiements: [],
              autorisationRemise: null,
              credit: {
                id: creditId,
                apport: 0,
                nombreTranches: 2,
                frequence: 'MENSUELLE',
                premiereEcheance: '2026-11-21',
                garantId: null,
                echeanceIds: [randomUUID(), randomUUID()],
              },
            },
          },
        ],
      })
      .expect(200);
    expect(body.resultats[0].statut).toBe('APPLIQUEE');
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('réglages : lus par le gérant, modifiés par le propriétaire seul', async () => {
    const { body } = await http()
      .get('/api/credits/parametres')
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(body).toMatchObject({ joursAvant: 3, relancesMax: 4, penaliteActive: false });
    const reglages = {
      joursAvant: 3,
      relancesMax: 2,
      canal: 'SMS',
      penaliteActive: true,
      penaliteType: 'POURCENTAGE',
      penaliteValeur: 10,
      penaliteGrace: 2,
    };
    await http()
      .put('/api/credits/parametres')
      .auth(gerant.jetonAcces, bearer)
      .send(reglages)
      .expect(403);
    await http()
      .put('/api/credits/parametres')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ ...reglages, penaliteValeur: 150 })
      .expect(400);
    await http()
      .put('/api/credits/parametres')
      .auth(proprietaire.jetonAcces, bearer)
      .send(reglages)
      .expect(200);
    const profil = await http().get('/api/auth/moi').auth(vendeur.jetonAcces, bearer).expect(200);
    expect(profil.body.commerce.rappels).toMatchObject({ relancesMax: 2, penaliteValeur: 10 });
  });

  it('rappel 3 jours avant, puis le jour même ; jamais deux fois le même jour', async () => {
    expect(await passer('2026-11-17')).toEqual({ rappels: 0, penalites: 0 });
    expect(await passer('2026-11-18')).toEqual({ rappels: 1, penalites: 0 });
    expect(await passer('2026-11-18')).toEqual({ rappels: 0, penalites: 0 });
    expect(await passer('2026-11-21')).toEqual({ rappels: 1, penalites: 0 });
    const envoyes = await messages();
    expect(envoyes.map((m) => m.type)).toEqual(['RAPPEL_ECHEANCE', 'RAPPEL_ECHEANCE']);
    expect(envoyes[0]).toMatchObject({ canal: 'SMS', clientId, referenceType: 'Echeance' });
    expect(envoyes[0].contenu).toMatch(/1 000 000 GNF à régler le 21\/11\/2026/);
  });

  it('retard : relance, pénalité après le délai de grâce, relances limitées', async () => {
    expect(await passer('2026-11-22')).toEqual({ rappels: 1, penalites: 0 });
    // 3 jours de retard > 2 jours de grâce : 10 % de la tranche, une seule fois.
    expect(await passer('2026-11-24')).toEqual({ rappels: 0, penalites: 1 });
    expect(await passer('2026-11-25')).toEqual({ rappels: 0, penalites: 0 });
    const [premiere] = await tranches();
    expect(premiere).toMatchObject({ penalite: 100_000n, nombreRelances: 1 });
    expect(
      (await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).montantRestant,
    ).toBe(2_100_000n);
    expect(await passer('2026-11-29')).toEqual({ rappels: 1, penalites: 0 });
    // Au plus 2 relances.
    expect(await passer('2026-12-06')).toEqual({ rappels: 0, penalites: 0 });
    const relance = (await messages()).filter((m) => m.type === 'RETARD_ECHEANCE');
    expect(relance).toHaveLength(2);
    expect(relance[1].contenu).toMatch(/1 100 000/);
  });

  it('« relancer maintenant » par le gérant ; tranche payée, pénalité comprise', async () => {
    await http()
      .post(`/api/credits/${creditId}/relancer`)
      .auth(vendeur.jetonAcces, bearer)
      .expect(403);
    const { body } = await http()
      .post(`/api/credits/${creditId}/relancer`)
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    // Relance à la date réelle (avant l'échéance simulée) : rappel de la tranche, pénalité comprise.
    expect(body).toMatchObject({ type: 'AVANT', montant: 1_100_000, canal: 'SMS' });
    expect(
      await prisma.journalAudit.count({
        where: { commerceId: d.commerce.id, action: 'RELANCE_MANUELLE' },
      }),
    ).toBe(1);

    // Paiement de la tranche et de sa pénalité : plus de relance de retard.
    const { body: lot } = await http()
      .post('/api/sync/operations')
      .auth(vendeur.jetonAcces, bearer)
      .send({
        operations: [
          {
            id: randomUUID(),
            type: 'CREDIT_ENCAISSER',
            boutiqueId: d.boutiqueA.id,
            faiteLe: new Date().toISOString(),
            contenu: {
              id: randomUUID(),
              creditId,
              dateEncaissement: new Date().toISOString(),
              moyen: 'ESPECES',
              montant: 1_100_000,
              reference: null,
              caisseId: null,
            },
          },
        ],
      })
      .expect(200);
    expect(lot.resultats[0].statut).toBe('APPLIQUEE');
    const [premiere, seconde] = await tranches();
    expect(premiere.soldeeLe).not.toBeNull();
    expect(seconde.montantPaye).toBe(0n);
    // Prochain rappel : 3 jours avant la seconde tranche.
    expect(await passer('2026-12-17')).toEqual({ rappels: 0, penalites: 0 });
    expect(await passer('2026-12-18')).toEqual({ rappels: 1, penalites: 0 });
  });

  it('commerce suspendu : aucun rappel', async () => {
    await prisma.commerce.update({ where: { id: d.commerce.id }, data: { statut: 'SUSPENDU' } });
    expect(await passer('2026-12-21')).toEqual({ rappels: 0, penalites: 0 });
    await prisma.commerce.update({ where: { id: d.commerce.id }, data: { statut: 'ACTIF' } });
  });
});
