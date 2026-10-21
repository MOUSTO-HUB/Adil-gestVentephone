/**
 * Mise en service : crée le commerce, sa première boutique et le compte du
 * propriétaire. Le mot de passe provisoire est affiché une seule fois ; le code PIN
 * est choisi à la première connexion.
 *
 *   docker compose -f docker-compose.prod.yml exec api node dist/cli/initialiser.js
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';

for (const fichier of ['.env', '../.env']) {
  if (!process.env.DATABASE_URL && existsSync(fichier)) process.loadEnvFile(fichier);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL manquant.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
// Lecture ligne à ligne : fonctionne au clavier comme avec des réponses envoyées par un script.
const question = createInterface({ input: stdin, terminal: false });
const lignes = question[Symbol.asyncIterator]();

async function demander(
  intitule: string,
  valider: (v: string) => string | null = (v) => (v ? null : 'Obligatoire.'),
  parDefaut = '',
): Promise<string> {
  for (;;) {
    stdout.write(`${intitule}${parDefaut ? ` [${parDefaut}]` : ''} : `);
    const ligne = await lignes.next();
    if (ligne.done) throw new Error('Saisie interrompue.');
    const reponse = String(ligne.value).trim() || parDefaut;
    // Réponses envoyées par un script : affichées comme si elles avaient été tapées.
    if (!stdin.isTTY) stdout.write(`${reponse}\n`);
    const erreur = valider(reponse);
    if (!erreur) return reponse;
    console.log(`  ${erreur}`);
  }
}

async function principal() {
  console.log('\nMise en service de GestVente Phone : commerce, boutique et propriétaire.\n');
  const commerce = await demander('Nom du commerce (ex. Adil Phone)');
  const telephone = await demander('Téléphone du commerce (+224…)', (v) =>
    /^\+\d{8,15}$/.test(v) ? null : 'Format international attendu : +224620000000.',
  );
  const boutique = await demander('Nom de la première boutique (ex. Adil Phone Madina)');
  const adresse = await demander('Adresse de la boutique', () => null);
  const prefixe = (
    await demander('Préfixe des factures (2 à 5 lettres, ex. MAD)', (v) =>
      /^[A-Za-z]{2,5}$/.test(v) ? null : '2 à 5 lettres.',
    )
  ).toUpperCase();
  const nom = await demander('Nom du propriétaire');
  const identifiant = (
    await demander('Identifiant de connexion du propriétaire', (v) =>
      /^[a-zA-Z0-9._-]{3,40}$/.test(v) ? null : '3 à 40 caractères : lettres, chiffres, . _ -',
    )
  ).toLowerCase();
  if (await prisma.utilisateur.findFirst({ where: { identifiant } })) {
    throw new Error(`L’identifiant « ${identifiant} » est déjà utilisé.`);
  }

  const motDePasse = randomBytes(12).toString('base64url');
  await prisma.$transaction(async (tx) => {
    const c = await tx.commerce.create({ data: { nom: commerce, telephone } });
    const b = await tx.boutique.create({
      data: { commerceId: c.id, nom: boutique, prefixe, adresse: adresse || null, telephone },
    });
    await tx.utilisateur.create({
      data: {
        commerceId: c.id,
        nom,
        identifiant,
        role: Role.PROPRIETAIRE,
        motDePasseHash: await hash(motDePasse),
        boutiques: { create: [{ boutiqueId: b.id }] },
      },
    });
  });
  console.log('\nCommerce, boutique et compte créés.');
  console.log(`  Identifiant : ${identifiant}`);
  console.log(`  Mot de passe provisoire (affiché une seule fois) : ${motDePasse}`);
  console.log('Le code PIN sera choisi à la première connexion.\n');
}

principal()
  .catch((e: unknown) => {
    console.error(`\nÉchec : ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    question.close();
    await prisma.$disconnect();
  });
