import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  type CleAppareil,
  connecter,
  creerCommerce,
  demarrerApplication,
  MOT_DE_PASSE,
  nouvelleCleAppareil,
  preuveAppareil,
  prismaDe,
  type SessionTest,
  supprimerCommerce,
} from './outils.js';

const MOT_DE_PASSE_CONCEPTEUR = 'Concepteur-Test-2026';

/** Certification des appareils : clé de l'appareil, codes d'autorisation, révocation. */
describe('Appareils autorisés (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let d: Awaited<ReturnType<typeof creerCommerce>>;
  let proprietaire: SessionTest;
  let gerant: SessionTest;
  const suffixe = randomUUID().slice(0, 8);
  const concepteurs = { a: randomUUID(), b: randomUUID() };
  const http = () => request(app.getHttpServer());
  const bearer = { type: 'bearer' as const };
  const appareil = { nom: 'Nouveau téléphone', plateforme: 'android' };

  const connexion = async (identifiant: string, cle?: CleAppareil, codeAppareil?: string) => {
    const preuve = cle ? await preuveAppareil(app, cle) : undefined;
    return http()
      .post('/api/auth/connexion')
      .send({
        identifiant,
        motDePasse: MOT_DE_PASSE,
        appareil,
        ...(preuve ? { preuve } : {}),
        ...(codeAppareil ? { codeAppareil } : {}),
      });
  };

  const connexionConcepteur = async (
    cle: string,
    cleAppareil: CleAppareil,
    codeAppareil?: string,
  ) => {
    const preuve = await preuveAppareil(app, cleAppareil);
    return http()
      .post('/api/plateforme/connexion')
      .send({
        identifiant: `${cle}-${suffixe}`,
        motDePasse: MOT_DE_PASSE_CONCEPTEUR,
        appareil: { nom: 'Ordinateur', plateforme: 'web' },
        preuve,
        ...(codeAppareil ? { codeAppareil } : {}),
      });
  };

  beforeAll(async () => {
    app = await demarrerApplication();
    prisma = prismaDe(app);
    d = await creerCommerce(prisma);
    for (const [cle, id] of Object.entries(concepteurs)) {
      await prisma.concepteur.create({
        data: {
          id,
          nom: `Concepteur ${cle.toUpperCase()}`,
          identifiant: `${cle}-${suffixe}`,
          motDePasseHash: await hash(MOT_DE_PASSE_CONCEPTEUR),
        },
      });
    }
    proprietaire = await connecter(app, d.proprietaire.identifiant);
    gerant = await connecter(app, d.gerantA.identifiant);
  });

  afterAll(async () => {
    await supprimerCommerce(prisma, d.commerce.id);
    const ids = Object.values(concepteurs);
    await prisma.certificatAppareil.deleteMany({ where: { concepteurId: { in: ids } } });
    await prisma.codeAppareil.deleteMany({ where: { concepteurId: { in: ids } } });
    await prisma.concepteur.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it('premier appareil autorisé d’office ; un autre appareil est refusé', async () => {
    const telephone = nouvelleCleAppareil();
    expect((await connexion(d.vendeurA.identifiant, telephone)).status).toBe(200);
    expect((await connexion(d.vendeurA.identifiant, telephone)).status).toBe(200);

    const autre = await connexion(d.vendeurA.identifiant, nouvelleCleAppareil());
    expect(autre.status).toBe(403);
    expect(autre.body.code).toBe('APPAREIL_NON_AUTORISE');
    const sansPreuve = await connexion(d.vendeurA.identifiant);
    expect(sansPreuve.body.code).toBe('APPAREIL_PREUVE_ABSENTE');

    // Défi signé par une autre clé que celle annoncée : refusé.
    const preuve = await preuveAppareil(app, nouvelleCleAppareil());
    const falsifiee = await http()
      .post('/api/auth/connexion')
      .send({
        identifiant: d.vendeurA.identifiant,
        motDePasse: MOT_DE_PASSE,
        appareil,
        preuve: { ...preuve, cle: telephone.publique },
      });
    expect(falsifiee.status).toBe(403);
    expect(falsifiee.body.code).toBe('APPAREIL_PREUVE_ABSENTE');
  });

  it('nouvel appareil par code du gérant : l’ancien est remplacé, le code ne sert qu’une fois', async () => {
    const ancien = nouvelleCleAppareil();
    await prisma.certificatAppareil.deleteMany({ where: { utilisateurId: d.vendeurA.id } });
    const sessionAncienne = (await connexion(d.vendeurA.identifiant, ancien)).body as SessionTest;

    const { body: acces } = await http()
      .post(`/api/utilisateurs/${d.vendeurA.id}/code-appareil`)
      .auth(gerant.jetonAcces, bearer)
      .send({ remplacer: true })
      .expect(200);
    expect(acces.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const nouveau = nouvelleCleAppareil();
    const faux = await connexion(d.vendeurA.identifiant, nouveau, 'AAAA-BBBB');
    expect(faux.body.code).toBe('CODE_APPAREIL_INVALIDE');
    const reussie = await connexion(d.vendeurA.identifiant, nouveau, acces.code.toLowerCase());
    expect(reussie.status).toBe(200);

    // Ancien appareil : session fermée et connexion refusée ; le code est déjà utilisé.
    await http().get('/api/auth/moi').auth(sessionAncienne.jetonAcces, bearer).expect(401);
    expect((await connexion(d.vendeurA.identifiant, ancien)).body.code).toBe(
      'APPAREIL_NON_AUTORISE',
    );
    const encore = await connexion(d.vendeurA.identifiant, nouvelleCleAppareil(), acces.code);
    expect(encore.body.code).toBe('CODE_APPAREIL_INVALIDE');

    const { body: liste } = await http()
      .get('/api/appareils/autorises')
      .auth(proprietaire.jetonAcces, bearer)
      .expect(200);
    const duVendeur = liste.appareils.filter(
      (a: { titulaireId: string }) => a.titulaireId === d.vendeurA.id,
    );
    expect(duVendeur.filter((a: { revoqueLe: string | null }) => !a.revoqueLe)).toHaveLength(1);
  });

  it('droits : le gérant ne gère pas le propriétaire, le vendeur ne gère rien', async () => {
    await http()
      .post(`/api/utilisateurs/${d.proprietaire.id}/code-appareil`)
      .auth(gerant.jetonAcces, bearer)
      .send({ remplacer: false })
      .expect(403);
    const vendeur = await connecter(app, d.vendeurB.identifiant);
    await http().get('/api/appareils/autorises').auth(vendeur.jetonAcces, bearer).expect(403);
  });

  it('le propriétaire retire un appareil : sa session se ferme aussitôt', async () => {
    const session = await connecter(app, d.vendeurB.identifiant);
    const certificat = await prisma.certificatAppareil.findFirstOrThrow({
      where: { utilisateurId: d.vendeurB.id, revoqueLe: null },
    });
    await http()
      .post(`/api/appareils/autorises/${certificat.id}/revocation`)
      .auth(proprietaire.jetonAcces, bearer)
      .expect(204);
    await http().get('/api/auth/moi').auth(session.jetonAcces, bearer).expect(401);
    const journal = await prisma.journalAudit.count({
      where: { commerceId: d.commerce.id, action: 'APPAREIL_REVOQUE' },
    });
    expect(journal).toBeGreaterThanOrEqual(1);
  });

  it('session ouverte avant la certification : l’appareil est enregistré', async () => {
    const cle = nouvelleCleAppareil();
    await prisma.certificatAppareil.deleteMany({ where: { utilisateurId: d.gerantA.id } });
    const session = (await connexion(d.gerantA.identifiant, cle)).body as SessionTest;
    await prisma.appareil.update({
      where: { id: session.appareilId },
      data: { certificatId: null },
    });
    await prisma.certificatAppareil.deleteMany({ where: { utilisateurId: d.gerantA.id } });
    const preuve = await preuveAppareil(app, cle);
    await http()
      .post('/api/auth/appareil/certificat')
      .auth(session.jetonAcces, bearer)
      .send(preuve)
      .expect(200);
    const lie = await prisma.appareil.findUniqueOrThrow({ where: { id: session.appareilId } });
    expect(lie.certificatId).not.toBeNull();
  });

  it('concepteurs : l’un donne un code à l’autre, qui change d’appareil', async () => {
    const ordiA = nouvelleCleAppareil();
    const ordiB = nouvelleCleAppareil();
    const jetonA = (await connexionConcepteur('a', ordiA)).body.jeton as string;
    const jetonB = (await connexionConcepteur('b', ordiB)).body.jeton as string;
    expect(jetonA).toBeTruthy();
    expect(jetonB).toBeTruthy();

    const nouveauA = nouvelleCleAppareil();
    expect((await connexionConcepteur('a', nouveauA)).body.code).toBe('APPAREIL_NON_AUTORISE');

    const { body: acces } = await http()
      .post(`/api/plateforme/concepteurs/${concepteurs.a}/code-appareil`)
      .auth(jetonB, bearer)
      .send({ remplacer: true })
      .expect(200);
    const reussie = await connexionConcepteur('a', nouveauA, acces.code);
    expect(reussie.status).toBe(200);
    // L'ancien ordinateur de A est révoqué : sa session ne passe plus.
    await http().get('/api/plateforme/tableau').auth(jetonA, bearer).expect(401);
    await http().get('/api/plateforme/tableau').auth(reussie.body.jeton, bearer).expect(200);

    const { body: liste } = await http()
      .get('/api/plateforme/appareils')
      .auth(jetonB, bearer)
      .expect(200);
    expect(liste.utilisateurs.some((u: { id: string }) => u.id === concepteurs.a)).toBe(true);
  });

  it('un concepteur aide un commerçant : code, puis révocation', async () => {
    const jetonB = (await connexionConcepteur('b', nouvelleCleAppareil())).body.jeton;
    expect(jetonB).toBeUndefined(); // ordiB seul est autorisé pour B
    const ordiB = await prisma.certificatAppareil.findFirstOrThrow({
      where: { concepteurId: concepteurs.b, revoqueLe: null },
    });
    expect(ordiB).toBeTruthy();

    // Code pour le propriétaire, créé par le concepteur A (nouvel appareil autorisé ci-dessus).
    const a = await prisma.certificatAppareil.findFirstOrThrow({
      where: { concepteurId: concepteurs.a, revoqueLe: null },
    });
    expect(a).toBeTruthy();
    const cleA = nouvelleCleAppareil();
    const inconnu = await connexionConcepteur('b', cleA);
    expect(inconnu.body.jeton).toBeUndefined(); // un appareil inconnu de B n'ouvre rien

    const jeton = (await connexionConcepteur('a', cleA, await codeDe(concepteurs.a))).body.jeton;
    const { body: acces } = await http()
      .post(`/api/plateforme/utilisateurs/${d.proprietaire.id}/code-appareil`)
      .auth(jeton, bearer)
      .send({ remplacer: false })
      .expect(200);
    const nouveau = nouvelleCleAppareil();
    const session = await connexion(d.proprietaire.identifiant, nouveau, acces.code);
    expect(session.status).toBe(200);
    const certificat = await prisma.certificatAppareil.findFirstOrThrow({
      where: { utilisateurId: d.proprietaire.id, origine: 'CODE', revoqueLe: null },
    });
    await http()
      .post(`/api/plateforme/appareils/${certificat.id}/revocation`)
      .auth(jeton, bearer)
      .expect(204);
    await http().get('/api/auth/moi').auth(session.body.jetonAcces, bearer).expect(401);
    // L'autre appareil du propriétaire (« appareil en plus ») reste autorisé.
    await http().get('/api/auth/moi').auth(proprietaire.jetonAcces, bearer).expect(200);
  });

  /** Code créé directement (comme la commande de secours du serveur) pour un concepteur. */
  async function codeDe(concepteurId: string) {
    const { empreinteCode, genererCode } = await import('../src/certificats/certificats.regles.js');
    const code = genererCode();
    await prisma.codeAppareil.create({
      data: {
        titulaire: 'CONCEPTEUR',
        concepteurId,
        codeHash: empreinteCode(code),
        remplacer: false,
        expireLe: new Date(Date.now() + 60_000),
        creePar: 'Test',
      },
    });
    return code;
  }
});
