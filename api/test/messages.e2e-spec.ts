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

const ECHEC_WHATSAPP = '+224620999001';
const ECHEC_PARTOUT = '+224620999002';

/** Réglages de la messagerie pour ce fichier (fournisseurs « journal », essais rapides). */
const REGLAGES: Record<string, string> = {
  WHATSAPP_FOURNISSEUR: 'journal',
  SMS_FOURNISSEUR: 'journal',
  MESSAGES_DELAI_MS: '50',
  MESSAGES_ECHEC_WHATSAPP: `${ECHEC_WHATSAPP},${ECHEC_PARTOUT}`,
  MESSAGES_ECHEC_SMS: ECHEC_PARTOUT,
  URL_PUBLIQUE: 'https://gestvente.exemple.com',
  REDIS_PREFIXE: `test-messages-${randomUUID().slice(0, 8)}`,
};

describe('Messagerie SMS et WhatsApp (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerant: SessionTest;
  let vendeur: SessionTest;
  let coqueId: string;
  let clientId: string;
  const anciens: Record<string, string | undefined> = {};
  const base = String(Date.now()).slice(-8);
  let numero = 0;
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };

  const envoyer = async (session: SessionTest, type: string, contenu: unknown) =>
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
    ).body.resultats[0] as { statut: string; motif?: string };

  const vendre = async (client: string | null) => {
    const contenu: VenteSaisie = {
      id: randomUUID(),
      numero: `MSG-${base}-${++numero}`,
      dateVente: new Date().toISOString(),
      clientId: client,
      lignes: [
        {
          id: randomUUID(),
          produitId: coqueId,
          articleId: null,
          quantite: 2,
          tarif: 'DETAIL',
          prixUnitaire: 750_000,
        },
      ],
      remise: 0,
      paiements: [{ id: randomUUID(), moyen: 'ESPECES', montant: 1_500_000, reference: null }],
      autorisationRemise: null,
    };
    expect((await envoyer(vendeur, 'VENTE_ENREGISTRER', contenu)).statut).toBe('APPLIQUEE');
    return contenu;
  };

  const demanderEnvoi = (
    venteId: string,
    canal: 'SMS' | 'WHATSAPP',
    telephone: string | null = null,
  ) =>
    envoyer(vendeur, 'MESSAGE_ENVOYER', {
      id: randomUUID(),
      venteId,
      type: 'FACTURE',
      canal,
      telephone,
    });

  /** Attend que les messages d'une vente atteignent l'état voulu (file BullMQ). */
  const attendre = async (
    venteId: string,
    condition: (m: { canal: string; statut: string }[]) => boolean,
  ) => {
    for (let i = 0; i < 100; i++) {
      const messages = await prisma.message.findMany({
        where: { referenceId: venteId },
        orderBy: { creeLe: 'asc' },
      });
      if (condition(messages)) return messages;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Délai dépassé pour les messages.');
  };

  beforeAll(async () => {
    for (const [cle, valeur] of Object.entries(REGLAGES)) {
      anciens[cle] = process.env[cle];
      process.env[cle] = valeur;
    }
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    const categorie = await prisma.categorie.create({
      data: { commerceId: d.commerce.id, nom: 'Accessoires', type: 'ACCESSOIRE' },
    });
    coqueId = (
      await prisma.produit.create({
        data: {
          commerceId: d.commerce.id,
          type: 'ACCESSOIRE',
          categorieId: categorie.id,
          nom: 'Écouteurs Oraimo',
          prixAchat: 500_000,
          prixDetail: 750_000,
          prixGros: 700_000,
        },
      })
    ).id;
    await prisma.stock.create({
      data: { produitId: coqueId, boutiqueId: d.boutiqueA.id, quantite: 50 },
    });
    clientId = (
      await prisma.client.create({
        data: { commerceId: d.commerce.id, nom: 'Fatoumata Camara', telephone: '+224621445566' },
      })
    ).id;
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
    vendeur = await connecter(app, d.vendeurA.identifiant);
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { commerceId: d.commerce.id } });
    await prisma.modeleMessage.deleteMany({ where: { commerceId: d.commerce.id } });
    await supprimerCommerce(prisma, d.commerce.id);
    await app.close();
    for (const [cle, valeur] of Object.entries(anciens)) {
      if (valeur === undefined) delete process.env[cle];
      else process.env[cle] = valeur;
    }
  });

  it('facture par SMS : envoyée au client, avec le lien public de la facture', async () => {
    const vente = await vendre(clientId);
    expect((await demanderEnvoi(vente.id, 'SMS')).statut).toBe('APPLIQUEE');
    const [message] = await attendre(vente.id, (m) => m[0]?.statut === 'ENVOYE');
    expect(message).toMatchObject({ canal: 'SMS', destinataire: '+224621445566', essais: 1 });
    const enBase = await prisma.vente.findUniqueOrThrow({ where: { id: vente.id } });
    expect(enBase.codePublic).toMatch(/^[A-Za-z0-9]{10}$/);
    const sms = (await prisma.message.findFirstOrThrow({ where: { referenceId: vente.id } }))
      .contenu;
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(sms).toContain(vente.numero);
    expect(sms).toContain('1 500 000 GNF');
    expect(sms).toContain(`https://gestvente.exemple.com/api/f/${enBase.codePublic}`);

    // La page publique de la facture : sans connexion, sans script.
    const page = await http().get(`/api/f/${enBase.codePublic}`).expect(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.text).toContain(vente.numero);
    expect(page.text).toContain('Fatoumata Camara');
    await http().get('/api/f/AAAAAAAAAA').expect(404);
    await http().get('/api/f/court').expect(404);
  });

  it('WhatsApp en échec : 3 essais puis bascule vers le SMS', async () => {
    const vente = await vendre(null);
    expect((await demanderEnvoi(vente.id, 'WHATSAPP', ECHEC_WHATSAPP)).statut).toBe('APPLIQUEE');
    const messages = await attendre(vente.id, (m) => m.length === 2 && m[1]?.statut === 'ENVOYE');
    expect(messages[0]).toMatchObject({ canal: 'WHATSAPP', statut: 'ECHEC', essais: 3 });
    expect(messages[0]?.erreur).toMatch(/Échec simulé/);
    expect(messages[1]).toMatchObject({
      canal: 'SMS',
      statut: 'ENVOYE',
      destinataire: ECHEC_WHATSAPP,
    });
  });

  it('échec partout : message en échec, relancé à la demande du gérant', async () => {
    const vente = await vendre(null);
    await demanderEnvoi(vente.id, 'SMS', ECHEC_PARTOUT);
    const [echec] = await attendre(vente.id, (m) => m[0]?.statut === 'ECHEC');
    const { body } = await http()
      .get('/api/messages')
      .query({ statut: 'ECHEC' })
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(body.messages.map((m: { id: string }) => m.id)).toContain(echec!.id);
    await http()
      .post(`/api/messages/${echec!.id}/relancer`)
      .auth(gerant.jetonAcces, bearer)
      .expect(204);
    // Le nouvel essai échoue encore (numéro en échec simulé) et le message y revient.
    await attendre(
      vente.id,
      (m) => m[0]?.statut === 'ECHEC' && (m[0] as { essais?: number }).essais === 3,
    );
    await http().get('/api/messages').auth(vendeur.jetonAcces, bearer).expect(403);
  });

  it('refuse un envoi sans numéro', async () => {
    const vente = await vendre(null);
    expect((await demanderEnvoi(vente.id, 'SMS')).motif).toMatch(/Aucun numéro/);
  });

  it('modèles : le propriétaire modifie le texte des SMS, contrôlé et journalisé', async () => {
    const texte = '{boutique} : merci {client}, facture {numero} ({montant} {monnaie}) : {lien}';
    await http()
      .put('/api/messages/modeles')
      .auth(gerant.jetonAcces, bearer)
      .send({ type: 'FACTURE', canal: 'SMS', texte })
      .expect(403);
    const refus = await http()
      .put('/api/messages/modeles')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ type: 'FACTURE', canal: 'SMS', texte: 'Bonjour {prenom}' })
      .expect(400);
    expect(refus.body.message).toMatch(/Variable inconnue/);
    await http()
      .put('/api/messages/modeles')
      .auth(proprietaire.jetonAcces, bearer)
      .send({ type: 'FACTURE', canal: 'SMS', texte })
      .expect(204);

    const vente = await vendre(clientId);
    await demanderEnvoi(vente.id, 'SMS');
    await attendre(vente.id, (m) => m[0]?.statut === 'ENVOYE');
    const sms = (await prisma.message.findFirstOrThrow({ where: { referenceId: vente.id } }))
      .contenu;
    expect(sms).toMatch(
      new RegExp(`^Boutique A : merci Fatoumata Camara, facture ${vente.numero}`),
    );

    const { body } = await http()
      .get('/api/messages/modeles')
      .auth(gerant.jetonAcces, bearer)
      .expect(200);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'FACTURE', canal: 'SMS', texte, personnalise: true }),
        expect.objectContaining({ type: 'FACTURE', canal: 'WHATSAPP', modifiable: false }),
      ]),
    );
    await http()
      .delete('/api/messages/modeles/FACTURE/SMS')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(204);
    expect(await prisma.modeleMessage.count({ where: { commerceId: d.commerce.id } })).toBe(0);
    expect(
      await prisma.journalAudit.count({
        where: { commerceId: d.commerce.id, action: 'MODELE_MESSAGE_MODIFIE' },
      }),
    ).toBe(2);
  });
});
