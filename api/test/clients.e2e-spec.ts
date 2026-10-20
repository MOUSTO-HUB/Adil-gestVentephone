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

interface ResultatOp {
  statut: string;
  motif?: string;
  corrections?: { entite: string; id: string; donnees: unknown }[];
}

const binaire = (res: request.Response, fin: (e: Error | null, corps: Buffer) => void) => {
  const morceaux: Buffer[] = [];
  res.on('data', (m: Buffer) => morceaux.push(m));
  res.on('end', () => fin(null, Buffer.concat(morceaux)));
};

describe('Clients et fournisseurs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let autre: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const clientId = randomUUID();

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

  const client = (surcharge: Record<string, unknown> = {}) => ({
    id: clientId,
    nom: 'Mamadou Diallo',
    telephone: '+224620112233',
    type: 'DETAIL',
    typePiece: 'CNI',
    numeroPiece: 'GN-CNI-1',
    adresse: 'Madina',
    plafondCredit: null,
    archive: false,
    garant: null,
    ...surcharge,
  });

  const garant = (surcharge: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    nom: 'Fatoumata Camara',
    telephone: '+224621445566',
    typePiece: null,
    numeroPiece: null,
    adresse: null,
    lien: 'Sœur',
    ...surcharge,
  });

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    autre = await creerCommerce(prisma);
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    await supprimerCommerce(prisma, autre.commerce.id);
    await app.close();
  });

  describe('clients', () => {
    it('un vendeur enregistre un client de détail, qui descend aux appareils', async () => {
      const { body: avant } = await http()
        .get('/api/sync/instantane')
        .auth(gerant.jetonAcces, bearer);
      expect((await envoyer(vendeur, 'CLIENT_ENREGISTRER', client())).statut).toBe('APPLIQUEE');
      const { body } = await http()
        .get('/api/sync/changements')
        .query({ curseur: avant.curseur })
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(body.changements).toEqual([
        expect.objectContaining({
          entite: 'client',
          id: clientId,
          donnees: expect.objectContaining({
            nom: 'Mamadou Diallo',
            photoPiece: false,
            plafondCredit: null,
          }),
        }),
      ]);
    });

    it('seul le propriétaire fixe le plafond de crédit (inscrit au journal d’audit)', async () => {
      const refus = await envoyer(
        gerant,
        'CLIENT_ENREGISTRER',
        client({ plafondCredit: 2_000_000 }),
      );
      expect(refus).toMatchObject({
        statut: 'REJETEE',
        motif: expect.stringMatching(/propriétaire/),
      });
      expect(refus.corrections?.[0]).toMatchObject({ entite: 'client', id: clientId });

      expect(
        (await envoyer(proprietaire, 'CLIENT_ENREGISTRER', client({ plafondCredit: 2_000_000 })))
          .statut,
      ).toBe('APPLIQUEE');
      const journal = await prisma.journalAudit.findFirst({
        where: { action: 'PLAFOND_CREDIT_MODIFIE', entiteId: clientId },
      });
      expect(journal?.details).toMatchObject({ avant: null, apres: 2_000_000 });

      // Un vendeur peut ensuite corriger l'adresse sans toucher au plafond.
      expect(
        (
          await envoyer(
            vendeur,
            'CLIENT_ENREGISTRER',
            client({ plafondCredit: 2_000_000, adresse: 'Kaloum' }),
          )
        ).statut,
      ).toBe('APPLIQUEE');
    });

    it('seuls propriétaire et gérants classent un client grossiste', async () => {
      const base = client({ plafondCredit: 2_000_000 });
      expect(
        (await envoyer(vendeur, 'CLIENT_ENREGISTRER', { ...base, type: 'GROSSISTE' })).motif,
      ).toMatch(/grossiste/);
      expect(
        (await envoyer(gerant, 'CLIENT_ENREGISTRER', { ...base, type: 'GROSSISTE' })).statut,
      ).toBe('APPLIQUEE');
    });

    it('ajoute, remplace puis retire le garant', async () => {
      const base = client({ plafondCredit: 2_000_000, type: 'GROSSISTE' });
      const premier = garant();
      await envoyer(gerant, 'CLIENT_ENREGISTRER', { ...base, garant: premier });
      expect(await prisma.garant.findMany({ where: { clientId } })).toEqual([
        expect.objectContaining({ id: premier.id, lien: 'Sœur' }),
      ]);
      const second = garant({ nom: 'Ibrahima Sow' });
      await envoyer(gerant, 'CLIENT_ENREGISTRER', { ...base, garant: second });
      expect((await prisma.garant.findMany({ where: { clientId } })).map((g) => g.id)).toEqual([
        second.id,
      ]);
      await envoyer(gerant, 'CLIENT_ENREGISTRER', { ...base, garant: null });
      expect(await prisma.garant.count({ where: { clientId } })).toBe(0);
    });

    it('refuse un téléphone qui n’est pas au format international', async () => {
      const r = await envoyer(
        vendeur,
        'CLIENT_ENREGISTRER',
        client({ id: randomUUID(), telephone: '620112233' }),
      );
      expect(r).toMatchObject({ statut: 'REJETEE', motif: expect.stringMatching(/téléphone/) });
    });

    it('historique (vide pour l’instant) et client d’un autre commerce introuvable', async () => {
      const { body } = await http()
        .get(`/api/clients/${clientId}/historique`)
        .auth(vendeur.jetonAcces, bearer)
        .expect(200);
      expect(body).toEqual({ ventes: [], credits: [], trocs: [] });
      const etranger = await connecter(app, autre.proprietaire.identifiant);
      await http()
        .get(`/api/clients/${clientId}/historique`)
        .auth(etranger.jetonAcces, bearer)
        .expect(404);
    });
  });

  describe('pièce d’identité', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)]);

    it('enregistrée par le personnel, lue sans cache, consultation journalisée', async () => {
      await http()
        .put(`/api/clients/${clientId}/piece`)
        .auth(vendeur.jetonAcces, bearer)
        .attach('photo', jpeg, { filename: 'cni.jpg', contentType: 'image/jpeg' })
        .expect(204);
      const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      expect(client.photoPieceCle).toMatch(/\.jpg$/);

      const lue = await http()
        .get(`/api/clients/${clientId}/piece`)
        .auth(gerant.jetonAcces, bearer)
        .buffer(true)
        .parse(binaire)
        .expect(200);
      expect(lue.headers['cache-control']).toBe('no-store');
      expect(Buffer.compare(lue.body as Buffer, jpeg)).toBe(0);
      expect(
        await prisma.journalAudit.count({
          where: { action: 'PIECE_IDENTITE_CONSULTEE', entiteId: clientId },
        }),
      ).toBe(1);

      // La clé du fichier n'est jamais exposée, ni la photo servie publiquement.
      const { body } = await http().get('/api/sync/instantane').auth(vendeur.jetonAcces, bearer);
      const vu = body.donnees.client.find((c: { id: string }) => c.id === clientId);
      expect(vu.photoPiece).toBe(true);
      expect(JSON.stringify(vu)).not.toContain(client.photoPieceCle);
      await http().get(`/api/photos/${client.photoPieceCle}`).expect(404);
    });

    it('refuse : sans jeton, autre commerce, fichier qui n’est pas une image ; suppression par un gérant', async () => {
      await http().get(`/api/clients/${clientId}/piece`).expect(401);
      const etranger = await connecter(app, autre.gerantA.identifiant);
      await http()
        .get(`/api/clients/${clientId}/piece`)
        .auth(etranger.jetonAcces, bearer)
        .expect(404);
      await http()
        .put(`/api/clients/${clientId}/piece`)
        .auth(vendeur.jetonAcces, bearer)
        .attach('photo', Buffer.from('pas une image'), {
          filename: 'x.jpg',
          contentType: 'image/jpeg',
        })
        .expect(400);
      await http()
        .delete(`/api/clients/${clientId}/piece`)
        .auth(vendeur.jetonAcces, bearer)
        .expect(403);
      await http()
        .delete(`/api/clients/${clientId}/piece`)
        .auth(gerant.jetonAcces, bearer)
        .expect(204);
      await http()
        .get(`/api/clients/${clientId}/piece`)
        .auth(gerant.jetonAcces, bearer)
        .expect(404);
    });
  });

  describe('fournisseurs', () => {
    const fournisseurId = randomUUID();
    const fournisseur = (surcharge: Record<string, unknown> = {}) => ({
      id: fournisseurId,
      nom: 'Dubaï Phones Import',
      telephone: '+971501234567',
      adresse: 'Deira, Dubaï',
      note: null,
      archive: false,
      ...surcharge,
    });

    it('réservés au propriétaire et aux gérants ; doublon de nom refusé', async () => {
      expect((await envoyer(vendeur, 'FOURNISSEUR_ENREGISTRER', fournisseur())).motif).toMatch(
        /rôle/,
      );
      expect((await envoyer(gerant, 'FOURNISSEUR_ENREGISTRER', fournisseur())).statut).toBe(
        'APPLIQUEE',
      );
      const doublon = await envoyer(
        gerant,
        'FOURNISSEUR_ENREGISTRER',
        fournisseur({ id: randomUUID(), nom: 'dubaï phones import' }),
      );
      expect(doublon.motif).toMatch(/existe déjà/);
    });

    it('dette et bons d’achat ; les vendeurs ne reçoivent pas les fournisseurs', async () => {
      await prisma.achat.create({
        data: {
          commerceId: d.commerce.id,
          boutiqueId: d.boutiqueA.id,
          fournisseurId,
          numero: `ACH-${randomUUID().slice(0, 6)}`,
          statut: 'RECU',
          montantTotal: 1_000_000,
          montantPaye: 400_000,
        },
      });
      const { body: achats } = await http()
        .get(`/api/fournisseurs/${fournisseurId}/achats`)
        .auth(gerant.jetonAcces, bearer)
        .expect(200);
      expect(achats.dette).toBe(600_000);
      expect(achats.achats[0]).toMatchObject({
        montantTotal: 1_000_000,
        reste: 600_000,
        boutique: 'Boutique A',
      });
      await http()
        .get(`/api/fournisseurs/${fournisseurId}/achats`)
        .auth(vendeur.jetonAcces, bearer)
        .expect(403);

      const pour = async (s: SessionTest) =>
        (await http().get('/api/sync/instantane').auth(s.jetonAcces, bearer)).body.donnees
          .fournisseur;
      expect(await pour(vendeur)).toEqual([]);
      expect(await pour(gerant)).toEqual([
        expect.objectContaining({ id: fournisseurId, dette: 600_000 }),
      ]);
    });
  });
});
