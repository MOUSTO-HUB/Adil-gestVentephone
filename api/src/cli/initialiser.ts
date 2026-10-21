/**
 * Mise en service : crée le compte du concepteur de la plateforme (mot de passe
 * affiché une seule fois). Les commerces, leurs boutiques et leurs propriétaires se
 * créent ensuite dans l'espace concepteur.
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
  console.log('\nMise en service de GestVente Phone : compte du concepteur de la plateforme.');
  console.log('Les commerçants se créent ensuite dans l’espace concepteur (écran de connexion).\n');
  const nom = await demander('Nom du concepteur');
  const identifiant = (
    await demander('Identifiant de connexion', (v) =>
      /^[a-zA-Z0-9._-]{3,40}$/.test(v) ? null : '3 à 40 caractères : lettres, chiffres, . _ -',
    )
  ).toLowerCase();
  if (await prisma.concepteur.findUnique({ where: { identifiant } })) {
    throw new Error(`L’identifiant « ${identifiant} » est déjà utilisé.`);
  }
  const motDePasse = randomBytes(12).toString('base64url');
  await prisma.concepteur.create({
    data: { nom, identifiant, motDePasseHash: await hash(motDePasse) },
  });
  console.log('\nCompte du concepteur créé.');
  console.log(`  Identifiant : ${identifiant}`);
  console.log(`  Mot de passe (affiché une seule fois) : ${motDePasse}\n`);
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
