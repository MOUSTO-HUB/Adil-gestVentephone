import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { completerImei, type CreditSaisi, type VenteSaisie } from '@gestvente/commun';
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

interface ResultatOp {
  statut: string;
  motif?: string;
  corrections?: { entite: string; id: string; donnees: Record<string, unknown> | null }[];
}

describe('Vente à crédit et tranches (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let vendeur: SessionTest;
  let gerant: SessionTest;
  let telephoneId: string;
  let articles: string[];
  let clientComplet: string;
  let clientSansAdresse: string;
  let clientSansPlafond: string;
  let numero = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const base = String(Date.now()).slice(-8);

  const envoyer = async (session: SessionTest, type: string, contenu: unknown) =>
    (
      (
        await http()
          .post('/api/sync/operations')
          .auth(session.jetonAcces, bearer)
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
      ).body.resultats as ResultatOp[]
    )[0];

  const credit = (apport: number, tranches = 3): CreditSaisi => ({
    id: randomUUID(),
    apport,
    nombreTranches: tranches,
    frequence: 'MENSUELLE',
    premiereEcheance: '2026-11-21',
    garantId: null,
    echeanceIds: Array.from({ length: tranches }, () => randomUUID()),
  });

  /** Téléphone à 3 000 000 vendu à crédit ; l'apport payé en espèces. */
  const venteCredit = (articleId: string, clientId: string, c: CreditSaisi, caisseId?: string) =>
    ({
      id: randomUUID(),
      numero: `CRED-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId,
      lignes: [
        {
          id: randomUUID(),
          produitId: telephoneId,
          articleId,
          quantite: 1,
          tarif: 'DETAIL',
          prixUnitaire: 3_000_000,
        },
      ],
      remise: 0,
      paiements: c.apport
        ? [{ id: randomUUID(), moyen: 'ESPECES', montant: c.apport, reference: null }]
        : [],
      autorisationRemise: null,
      caisseId: caisseId ?? null,
      credit: c,
    }) as VenteSaisie;

  const encaissement = (creditId: string, montant: number, surcharge: object = {}) => ({
    id: randomUUID(),
    creditId,
    dateEncaissement: new Date().toISOString(),
    moyen: 'ESPECES',
    montant,
    reference: null,
    caisseId: null,
    ...surcharge,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const commerceId = d.commerce.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Smartphones', type: 'TELEPHONE' },
    });
    telephoneId = (
      await prisma.produit.create({
        data: {
          commerceId,
          type: 'TELEPHONE',
          categorieId: categorie.id,
          nom: 'Samsung A55 256 Go',
          garantieMois: 3,
          prixAchat: 2_500_000,
          prixDetail: 3_000_000,
          prixGros: 2_900_000,
        },
      })
    ).id;
    await prisma.stock.create({
      data: { produitId: telephoneId, boutiqueId: d.boutiqueA.id, quantite: 5 },
    });
    articles = [];
    for (let i = 1; i <= 5; i++) {
      const a = await prisma.article.create({
        data: {
          commerceId,
          produitId: telephoneId,
          boutiqueId: d.boutiqueA.id,
          imei: completerImei(`87${base}000${i}`),
          prixAchat: 2_500_000,
        },
      });
      articles.push(a.id);
    }
    const client = (nom: string, adresse: string | null, plafondCredit: number | null) =>
      prisma.client.create({
        data: {
          commerceId,
          nom,
          telephone: `+22462${base.slice(-4)}${String(++numero).padStart(3, '0')}`,
          typePiece: 'CNI',
          numeroPiece: `GN-${numero}`,
          adresse,
          plafondCredit,
        },
      });
    clientComplet = (await client('Binta Diallo', 'Madina, Conakry', 5_000_000)).id;
    clientSansAdresse = (await client('Sans adresse', null, 5_000_000)).id;
    clientSansPlafond = (await client('Sans plafond', 'Kaloum', null)).id;
    vendeur = await connecter(app, d.vendeurA.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
  });

  it('fiche complète et plafond fixé obligatoires', async () => {
    const sansAdresse = await envoyer(
      vendeur,
      'VENTE_ENREGISTRER',
      venteCredit(articles[0], clientSansAdresse, credit(600_000)),
    );
    expect(sansAdresse).toMatchObject({
      statut: 'REJETEE',
      motif: expect.stringMatching(/adresse/),
    });
    const c = credit(600_000);
    const sansPlafond = await envoyer(
      vendeur,
      'VENTE_ENREGISTRER',
      venteCredit(articles[0], clientSansPlafond, c),
    );
    expect(sansPlafond).toMatchObject({
      statut: 'REJETEE',
      motif: expect.stringMatching(/plafond/),
    });
    // Les tranches créées sur l'appareil sont effacées.
    expect(sansPlafond.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entite: 'credit', id: c.id, donnees: null }),
        expect.objectContaining({ entite: 'echeance', id: c.echeanceIds[0], donnees: null }),
      ]),
    );
  });

  let creditId: string;
  let caisseId: string;

  it('crédit accordé : apport encaissé, échéancier mensuel, dernière tranche ajustée', async () => {
    caisseId = randomUUID();
    expect(
      (
        await envoyer(vendeur, 'CAISSE_OUVRIR', {
          id: caisseId,
          ouverteLe: new Date().toISOString(),
          fondInitial: 100_000,
        })
      ).statut,
    ).toBe('APPLIQUEE');
    const c = credit(500_000, 3);
    creditId = c.id;
    const contenu = venteCredit(articles[0], clientComplet, c, caisseId);
    expect(await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).toMatchObject({
      statut: 'APPLIQUEE',
    });
    expect(await prisma.vente.findUniqueOrThrow({ where: { id: contenu.id } })).toMatchObject({
      mode: 'CREDIT',
      total: 3_000_000n,
      montantPaye: 500_000n,
    });
    expect(await prisma.credit.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      montantFinance: 2_500_000n,
      montantRestant: 2_500_000n,
      statut: 'EN_COURS',
      clientId: clientComplet,
    });
    const tranches = await prisma.echeance.findMany({
      where: { creditId: c.id },
      orderBy: { numero: 'asc' },
    });
    expect(tranches.map((t) => [t.dateEcheance.toISOString().slice(0, 10), t.montant])).toEqual([
      ['2026-11-21', 833_333n],
      ['2026-12-21', 833_333n],
      ['2027-01-21', 833_334n],
    ]);
    // Annulation et retour : refusés (le crédit se traite à part).
    expect(
      (await envoyer(gerant, 'VENTE_ANNULER', { venteId: contenu.id, motif: 'Erreur' })).statut,
    ).toBe('CONFLIT');
  });

  it('plafond : encours + nouveau crédit, contrôlé au serveur', async () => {
    // Encours 2 500 000 + 3 000 000 > 5 000 000.
    expect(
      await envoyer(
        vendeur,
        'VENTE_ENREGISTRER',
        venteCredit(articles[1], clientComplet, credit(0)),
      ),
    ).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/Plafond/) });
    expect(
      (
        await envoyer(
          vendeur,
          'VENTE_ENREGISTRER',
          venteCredit(articles[1], clientComplet, credit(500_000, 2)),
        )
      ).statut,
    ).toBe('APPLIQUEE');
  });

  it('tranche partielle puis solde : reçu de la caisse, crédit soldé', async () => {
    const partiel = encaissement(creditId, 500_000, { caisseId });
    expect((await envoyer(vendeur, 'CREDIT_ENCAISSER', partiel)).statut).toBe('APPLIQUEE');
    const apres = await prisma.echeance.findMany({
      where: { creditId },
      orderBy: { numero: 'asc' },
    });
    expect(apres.map((e) => e.montantPaye)).toEqual([500_000n, 0n, 0n]);
    expect(
      (await prisma.credit.findUniqueOrThrow({ where: { id: creditId } })).montantRestant,
    ).toBe(2_000_000n);
    expect(
      (await prisma.encaissement.findUniqueOrThrow({ where: { id: partiel.id } })).caisseId,
    ).toBe(caisseId);

    expect(
      await envoyer(
        vendeur,
        'CREDIT_ENCAISSER',
        encaissement(creditId, 100_000, { moyen: 'ORANGE_MONEY' }),
      ),
    ).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/référence/) });
    expect(
      await envoyer(vendeur, 'CREDIT_ENCAISSER', encaissement(creditId, 2_000_001)),
    ).toMatchObject({ statut: 'CONFLIT', motif: expect.stringMatching(/2000000/) });
    expect(
      (
        await envoyer(
          vendeur,
          'CREDIT_ENCAISSER',
          encaissement(creditId, 2_000_000, { moyen: 'MTN_MOMO', reference: 'MOMO-77' }),
        )
      ).statut,
    ).toBe('APPLIQUEE');
    const solde = await prisma.credit.findUniqueOrThrow({
      where: { id: creditId },
      include: { echeances: true },
    });
    expect(solde).toMatchObject({ statut: 'SOLDE', montantRestant: 0n });
    expect(solde.echeances.every((e) => e.soldeeLe !== null)).toBe(true);
    expect((await envoyer(vendeur, 'CREDIT_ENCAISSER', encaissement(creditId, 1))).statut).toBe(
      'CONFLIT',
    );

    // La caisse attend le fond, l'apport et la tranche en espèces.
    expect(
      await envoyer(vendeur, 'CAISSE_CLOTURER', {
        caisseId,
        clotureeLe: new Date().toISOString(),
        comptage: { ESPECES: 1_100_000, ORANGE_MONEY: 0, MTN_MOMO: 0, VIREMENT: 0 },
        commentaire: null,
      }),
    ).toMatchObject({ statut: 'APPLIQUEE' });
    const caisse = await prisma.caisse.findUniqueOrThrow({ where: { id: caisseId } });
    expect(caisse.ecart).toBe(0n);
  });

  it('les appareils reçoivent crédits, tranches et encaissements', async () => {
    const { body } = await http()
      .get('/api/sync/instantane')
      .auth(vendeur.jetonAcces, bearer)
      .expect(200);
    expect(body.donnees.credit.find((c: { id: string }) => c.id === creditId)).toMatchObject({
      statut: 'SOLDE',
      numeroVente: expect.stringMatching(/^CRED-/),
      premiereEcheance: '2026-11-21',
    });
    expect(
      body.donnees.echeance.filter((e: { creditId: string }) => e.creditId === creditId),
    ).toHaveLength(3);
    expect(
      body.donnees.encaissement.filter((e: { creditId: string }) => e.creditId === creditId),
    ).toHaveLength(2);
  });
});
