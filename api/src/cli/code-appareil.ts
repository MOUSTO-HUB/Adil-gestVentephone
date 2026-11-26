/**
 * Secours : code d'autorisation d'un nouvel appareil pour un concepteur, quand aucun autre
 * concepteur ne peut le lui donner (seul concepteur, tous ses appareils perdus).
 * À lancer sur le serveur, dans le dossier de l'API :
 *
 *   node dist/cli/code-appareil.js identifiant-du-concepteur
 *
 * Le code (valable 24 heures, une seule fois) remplace les anciens appareils du concepteur.
 */
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { empreinteCode, genererCode, VALIDITE_CODE_MS } from '../certificats/certificats.regles.js';
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

async function principal() {
  const identifiant = (process.argv[2] ?? '').trim().toLowerCase();
  if (!identifiant)
    throw new Error(
      'Indiquez l’identifiant du concepteur : node dist/cli/code-appareil.js <identifiant>',
    );
  const concepteur = await prisma.concepteur.findUnique({ where: { identifiant } });
  if (!concepteur || concepteur.supprimeLe)
    throw new Error(`Concepteur « ${identifiant} » introuvable.`);
  const maintenant = new Date();
  await prisma.codeAppareil.updateMany({
    where: { concepteurId: concepteur.id, utiliseLe: null, annuleLe: null },
    data: { annuleLe: maintenant },
  });
  const code = genererCode();
  const expireLe = new Date(maintenant.getTime() + VALIDITE_CODE_MS);
  await prisma.codeAppareil.create({
    data: {
      titulaire: 'CONCEPTEUR',
      concepteurId: concepteur.id,
      codeHash: empreinteCode(code),
      remplacer: true,
      expireLe,
      creePar: 'Serveur (commande de secours)',
    },
  });
  console.log(`\nCode d’autorisation pour ${concepteur.nom} (${identifiant}) : ${code}`);
  console.log(`Valable jusqu’au ${expireLe.toLocaleString('fr-FR')}, une seule fois.`);
  console.log('À saisir sur le nouvel appareil, à la connexion de l’espace concepteur.\n');
}

principal()
  .catch((e: unknown) => {
    console.error(`\nÉchec : ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
