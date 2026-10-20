import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/** Contraintes de la base sur lesquelles reposent les règles métier. */
describe('Schéma de la base (e2e)', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let commerceId: string;
  let boutiqueId: string;
  let produitId: string;

  beforeAll(async () => {
    const commerce = await prisma.commerce.create({ data: { nom: `Test ${randomUUID()}` } });
    commerceId = commerce.id;
    const boutique = await prisma.boutique.create({
      data: { commerceId, nom: 'Boutique test', prefixe: 'TST' },
    });
    boutiqueId = boutique.id;
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
    });
    const produit = await prisma.produit.create({
      data: {
        commerceId,
        type: 'TELEPHONE',
        categorieId: categorie.id,
        nom: 'Téléphone test',
        prixAchat: 1_000_000,
        prixDetail: 1_200_000,
        prixGros: 1_100_000,
      },
    });
    produitId = produit.id;
  });

  afterAll(async () => {
    await prisma.article.deleteMany({ where: { commerceId } });
    await prisma.produit.deleteMany({ where: { commerceId } });
    await prisma.categorie.deleteMany({ where: { commerceId } });
    await prisma.boutique.deleteMany({ where: { commerceId } });
    await prisma.commerce.delete({ where: { id: commerceId } });
    await prisma.$disconnect();
  });

  const article = (imei: string) => ({
    commerceId,
    boutiqueId,
    produitId,
    imei,
    prixAchat: 1_000_000,
  });

  it('un IMEI est unique dans un commerce', async () => {
    await prisma.article.create({ data: article('352099009999990') });
    await expect(prisma.article.create({ data: article('352099009999990') })).rejects.toThrow();
  });

  it('les montants sont des entiers sans limite de 32 bits', async () => {
    const cree = await prisma.article.create({
      data: { ...article('352099009999982'), prixAchat: 5_000_000_000 },
    });
    expect(cree.prixAchat).toBe(5_000_000_000n);
  });

  it("un identifiant généré sur l'appareil est conservé", async () => {
    const id = randomUUID();
    const cree = await prisma.article.create({ data: { ...article('352099009999974'), id } });
    expect(cree.id).toBe(id);
  });
});
