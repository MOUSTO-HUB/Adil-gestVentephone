/**
 * Données de démonstration : 1 commerce, 1 boutique, 4 comptes (propriétaire,
 * gérant, 2 vendeurs), 40 produits (20 variantes de téléphones et 20 accessoires),
 * 60 téléphones avec IMEI, 10 clients et 3 fournisseurs.
 *
 * Lancement : pnpm db:seed (ou pnpm --filter @gestvente/api db:reset pour repartir de zéro).
 * Mot de passe des comptes : SEED_MOT_DE_PASSE (voir .env.example).
 */
import { randomUUID } from 'node:crypto';
import { completerImei } from '@gestvente/commun';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from 'dotenv';
import { PrismaClient, Role, TypeClient, TypePiece } from '../src/generated/prisma/client.js';

config({ path: ['.env', '../.env'], quiet: true });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface VarianteTelephone {
  marque: string;
  modele: string;
  capacite: string;
  couleur: string;
  prixAchat: number;
  prixDetail: number;
  prixGros: number;
}

const TELEPHONES: VarianteTelephone[] = [
  {
    marque: 'Tecno',
    modele: 'Spark 20',
    capacite: '128 Go',
    couleur: 'Noir',
    prixAchat: 1_250_000,
    prixDetail: 1_500_000,
    prixGros: 1_400_000,
  },
  {
    marque: 'Tecno',
    modele: 'Spark 20',
    capacite: '256 Go',
    couleur: 'Bleu',
    prixAchat: 1_450_000,
    prixDetail: 1_750_000,
    prixGros: 1_620_000,
  },
  {
    marque: 'Tecno',
    modele: 'Camon 30',
    capacite: '256 Go',
    couleur: 'Vert',
    prixAchat: 2_300_000,
    prixDetail: 2_750_000,
    prixGros: 2_600_000,
  },
  {
    marque: 'Tecno',
    modele: 'Pop 8',
    capacite: '64 Go',
    couleur: 'Noir',
    prixAchat: 650_000,
    prixDetail: 800_000,
    prixGros: 740_000,
  },
  {
    marque: 'Infinix',
    modele: 'Hot 40i',
    capacite: '128 Go',
    couleur: 'Doré',
    prixAchat: 1_100_000,
    prixDetail: 1_350_000,
    prixGros: 1_250_000,
  },
  {
    marque: 'Infinix',
    modele: 'Hot 40i',
    capacite: '256 Go',
    couleur: 'Noir',
    prixAchat: 1_300_000,
    prixDetail: 1_580_000,
    prixGros: 1_470_000,
  },
  {
    marque: 'Infinix',
    modele: 'Note 40',
    capacite: '256 Go',
    couleur: 'Noir',
    prixAchat: 2_100_000,
    prixDetail: 2_500_000,
    prixGros: 2_350_000,
  },
  {
    marque: 'Itel',
    modele: 'A70',
    capacite: '64 Go',
    couleur: 'Bleu',
    prixAchat: 550_000,
    prixDetail: 690_000,
    prixGros: 630_000,
  },
  {
    marque: 'Itel',
    modele: 'S24',
    capacite: '128 Go',
    couleur: 'Blanc',
    prixAchat: 950_000,
    prixDetail: 1_150_000,
    prixGros: 1_070_000,
  },
  {
    marque: 'Samsung',
    modele: 'Galaxy A15',
    capacite: '128 Go',
    couleur: 'Noir',
    prixAchat: 1_600_000,
    prixDetail: 1_900_000,
    prixGros: 1_780_000,
  },
  {
    marque: 'Samsung',
    modele: 'Galaxy A25',
    capacite: '128 Go',
    couleur: 'Bleu',
    prixAchat: 2_200_000,
    prixDetail: 2_600_000,
    prixGros: 2_450_000,
  },
  {
    marque: 'Samsung',
    modele: 'Galaxy A55',
    capacite: '256 Go',
    couleur: 'Lilas',
    prixAchat: 4_100_000,
    prixDetail: 4_800_000,
    prixGros: 4_550_000,
  },
  {
    marque: 'Samsung',
    modele: 'Galaxy S24',
    capacite: '256 Go',
    couleur: 'Noir',
    prixAchat: 7_800_000,
    prixDetail: 9_000_000,
    prixGros: 8_600_000,
  },
  {
    marque: 'Xiaomi',
    modele: 'Redmi 13C',
    capacite: '128 Go',
    couleur: 'Vert',
    prixAchat: 1_050_000,
    prixDetail: 1_300_000,
    prixGros: 1_200_000,
  },
  {
    marque: 'Xiaomi',
    modele: 'Redmi Note 13',
    capacite: '256 Go',
    couleur: 'Noir',
    prixAchat: 2_200_000,
    prixDetail: 2_650_000,
    prixGros: 2_480_000,
  },
  {
    marque: 'Apple',
    modele: 'iPhone 11',
    capacite: '64 Go',
    couleur: 'Blanc',
    prixAchat: 2_900_000,
    prixDetail: 3_400_000,
    prixGros: 3_200_000,
  },
  {
    marque: 'Apple',
    modele: 'iPhone 13',
    capacite: '128 Go',
    couleur: 'Minuit',
    prixAchat: 4_900_000,
    prixDetail: 5_700_000,
    prixGros: 5_400_000,
  },
  {
    marque: 'Apple',
    modele: 'iPhone 13',
    capacite: '256 Go',
    couleur: 'Bleu',
    prixAchat: 5_600_000,
    prixDetail: 6_500_000,
    prixGros: 6_150_000,
  },
  {
    marque: 'Apple',
    modele: 'iPhone 15',
    capacite: '128 Go',
    couleur: 'Noir',
    prixAchat: 8_200_000,
    prixDetail: 9_500_000,
    prixGros: 9_000_000,
  },
  {
    marque: 'Apple',
    modele: 'iPhone 15 Pro',
    capacite: '256 Go',
    couleur: 'Titane',
    prixAchat: 11_500_000,
    prixDetail: 13_200_000,
    prixGros: 12_600_000,
  },
];

interface Accessoire {
  categorie: string;
  nom: string;
  marque?: string;
  prixAchat: number;
  prixDetail: number;
  prixGros: number;
  quantite: number;
  /// Modèles compatibles (« Marque Modèle »).
  compatibles?: string[];
}

const ACCESSOIRES: Accessoire[] = [
  {
    categorie: 'Coques',
    nom: 'Coque anti-casse iPhone 13',
    prixAchat: 25_000,
    prixDetail: 50_000,
    prixGros: 40_000,
    quantite: 30,
    compatibles: ['Apple iPhone 13'],
  },
  {
    categorie: 'Coques',
    nom: 'Coque anti-casse iPhone 15',
    prixAchat: 30_000,
    prixDetail: 60_000,
    prixGros: 48_000,
    quantite: 25,
    compatibles: ['Apple iPhone 15', 'Apple iPhone 15 Pro'],
  },
  {
    categorie: 'Coques',
    nom: 'Coque silicone Galaxy A15',
    prixAchat: 15_000,
    prixDetail: 35_000,
    prixGros: 27_000,
    quantite: 40,
    compatibles: ['Samsung Galaxy A15'],
  },
  {
    categorie: 'Coques',
    nom: 'Coque silicone Spark 20',
    prixAchat: 12_000,
    prixDetail: 30_000,
    prixGros: 22_000,
    quantite: 50,
    compatibles: ['Tecno Spark 20'],
  },
  {
    categorie: 'Coques',
    nom: 'Coque Hot 40i',
    prixAchat: 12_000,
    prixDetail: 30_000,
    prixGros: 22_000,
    quantite: 35,
    compatibles: ['Infinix Hot 40i'],
  },
  {
    categorie: 'Protège-écrans',
    nom: 'Verre trempé iPhone 13/14',
    prixAchat: 10_000,
    prixDetail: 25_000,
    prixGros: 18_000,
    quantite: 60,
    compatibles: ['Apple iPhone 13'],
  },
  {
    categorie: 'Protège-écrans',
    nom: 'Verre trempé iPhone 15',
    prixAchat: 12_000,
    prixDetail: 30_000,
    prixGros: 22_000,
    quantite: 45,
    compatibles: ['Apple iPhone 15'],
  },
  {
    categorie: 'Protège-écrans',
    nom: 'Verre trempé Galaxy A15/A25',
    prixAchat: 8_000,
    prixDetail: 20_000,
    prixGros: 15_000,
    quantite: 70,
    compatibles: ['Samsung Galaxy A15', 'Samsung Galaxy A25'],
  },
  {
    categorie: 'Protège-écrans',
    nom: 'Verre trempé Spark 20 / Hot 40i',
    prixAchat: 6_000,
    prixDetail: 15_000,
    prixGros: 11_000,
    quantite: 80,
    compatibles: ['Tecno Spark 20', 'Infinix Hot 40i'],
  },
  {
    categorie: 'Chargeurs',
    nom: 'Chargeur rapide USB-C 25 W',
    marque: 'Samsung',
    prixAchat: 60_000,
    prixDetail: 110_000,
    prixGros: 90_000,
    quantite: 20,
    compatibles: ['Samsung Galaxy A25', 'Samsung Galaxy A55', 'Samsung Galaxy S24'],
  },
  {
    categorie: 'Chargeurs',
    nom: 'Chargeur USB-C 20 W',
    marque: 'Apple',
    prixAchat: 90_000,
    prixDetail: 160_000,
    prixGros: 135_000,
    quantite: 15,
    compatibles: ['Apple iPhone 15', 'Apple iPhone 15 Pro'],
  },
  {
    categorie: 'Chargeurs',
    nom: 'Chargeur Micro-USB 10 W',
    prixAchat: 15_000,
    prixDetail: 35_000,
    prixGros: 25_000,
    quantite: 50,
  },
  {
    categorie: 'Câbles',
    nom: 'Câble USB-C 1 m',
    prixAchat: 10_000,
    prixDetail: 25_000,
    prixGros: 18_000,
    quantite: 100,
  },
  {
    categorie: 'Câbles',
    nom: 'Câble Lightning 1 m',
    prixAchat: 15_000,
    prixDetail: 35_000,
    prixGros: 26_000,
    quantite: 60,
    compatibles: ['Apple iPhone 11', 'Apple iPhone 13'],
  },
  {
    categorie: 'Câbles',
    nom: 'Câble Micro-USB 1 m',
    prixAchat: 7_000,
    prixDetail: 15_000,
    prixGros: 11_000,
    quantite: 90,
  },
  {
    categorie: 'Écouteurs et casques',
    nom: 'Écouteurs Bluetooth Oraimo FreePods',
    marque: 'Oraimo',
    prixAchat: 120_000,
    prixDetail: 190_000,
    prixGros: 165_000,
    quantite: 25,
  },
  {
    categorie: 'Écouteurs et casques',
    nom: 'Écouteurs filaires jack 3,5 mm',
    prixAchat: 10_000,
    prixDetail: 25_000,
    prixGros: 18_000,
    quantite: 70,
  },
  {
    categorie: 'Écouteurs et casques',
    nom: 'Casque Bluetooth P47',
    prixAchat: 45_000,
    prixDetail: 85_000,
    prixGros: 70_000,
    quantite: 20,
  },
  {
    categorie: 'Batteries externes',
    nom: 'Batterie externe 10 000 mAh',
    marque: 'Oraimo',
    prixAchat: 110_000,
    prixDetail: 180_000,
    prixGros: 155_000,
    quantite: 18,
  },
  {
    categorie: 'Batteries externes',
    nom: 'Batterie externe 20 000 mAh',
    marque: 'Oraimo',
    prixAchat: 180_000,
    prixDetail: 280_000,
    prixGros: 245_000,
    quantite: 12,
  },
];

const CLIENTS: { nom: string; telephone: string; type: TypeClient; plafondCredit?: number }[] = [
  {
    nom: 'Mamadou Diallo',
    telephone: '+224620112233',
    type: TypeClient.DETAIL,
    plafondCredit: 3_000_000,
  },
  { nom: 'Fatoumata Camara', telephone: '+224621445566', type: TypeClient.DETAIL },
  {
    nom: 'Ibrahima Sow',
    telephone: '+224622778899',
    type: TypeClient.DETAIL,
    plafondCredit: 2_000_000,
  },
  { nom: 'Aissatou Bah', telephone: '+224623001122', type: TypeClient.DETAIL },
  { nom: 'Ousmane Barry', telephone: '+224624334455', type: TypeClient.DETAIL },
  {
    nom: 'Kadiatou Soumah',
    telephone: '+224625667788',
    type: TypeClient.DETAIL,
    plafondCredit: 1_500_000,
  },
  {
    nom: 'Alpha Condé Télécom',
    telephone: '+224626990011',
    type: TypeClient.GROSSISTE,
    plafondCredit: 20_000_000,
  },
  { nom: 'Mariama Keïta', telephone: '+224627223344', type: TypeClient.DETAIL },
  {
    nom: 'Sékou Touré Mobile',
    telephone: '+224628556677',
    type: TypeClient.GROSSISTE,
    plafondCredit: 15_000_000,
  },
  { nom: 'Hawa Sylla', telephone: '+224629889900', type: TypeClient.DETAIL },
];

const FOURNISSEURS = [
  { nom: 'Dubaï Phones Import', telephone: '+971501234567', adresse: 'Deira, Dubaï' },
  {
    nom: 'Madina Grossiste Télécom',
    telephone: '+224655112233',
    adresse: 'Marché Madina, Conakry',
  },
  { nom: 'Accessoires Plus Guinée', telephone: '+224664445566', adresse: 'Kaloum, Conakry' },
];

/** Nombre de téléphones (IMEI) par variante : 60 au total. */
const IMEI_PAR_VARIANTE = 3;

async function main() {
  if ((await prisma.commerce.count()) > 0) {
    console.log(
      'La base contient déjà des données : rien à faire (pnpm db:reset pour repartir de zéro).',
    );
    return;
  }
  const motDePasse = process.env.SEED_MOT_DE_PASSE;
  if (!motDePasse) {
    throw new Error('SEED_MOT_DE_PASSE manquant (voir .env.example).');
  }
  const motDePasseHash = await hash(motDePasse);
  const pinHash = await hash('1234');

  const commerce = await prisma.commerce.create({
    data: { nom: 'Adil Phone', telephone: '+224620000000', adresse: 'Madina, Conakry' },
  });
  const commerceId = commerce.id;
  const boutique = await prisma.boutique.create({
    data: {
      commerceId,
      nom: 'Adil Phone Madina',
      prefixe: 'MAD',
      adresse: 'Marché Madina, Conakry',
      telephone: '+224620000001',
    },
  });
  const boutiqueId = boutique.id;

  const comptes = [
    { nom: 'Adil Bangoura', identifiant: 'proprietaire', role: Role.PROPRIETAIRE },
    { nom: 'Thierno Baldé', identifiant: 'gerant', role: Role.GERANT },
    { nom: 'Abdoulaye Kaba', identifiant: 'vendeur1', role: Role.VENDEUR },
    { nom: 'Nènè Diallo', identifiant: 'vendeur2', role: Role.VENDEUR },
  ];
  for (const compte of comptes) {
    await prisma.utilisateur.create({
      data: {
        ...compte,
        commerceId,
        motDePasseHash,
        pinHash,
        boutiques: { create: { boutiqueId } },
      },
    });
  }

  // Catalogue : catégories, marques, modèles.
  const categorieTelephones = await prisma.categorie.create({
    data: { commerceId, nom: 'Téléphones', type: 'TELEPHONE' },
  });
  const categories = new Map<string, string>();
  for (const nom of new Set(ACCESSOIRES.map((a) => a.categorie))) {
    const categorie = await prisma.categorie.create({
      data: { commerceId, nom, type: 'ACCESSOIRE' },
    });
    categories.set(nom, categorie.id);
  }
  const marques = new Map<string, string>();
  for (const nom of new Set([
    ...TELEPHONES.map((t) => t.marque),
    ...ACCESSOIRES.flatMap((a) => (a.marque ? [a.marque] : [])),
  ])) {
    const marque = await prisma.marque.create({ data: { commerceId, nom } });
    marques.set(nom, marque.id);
  }
  const modeles = new Map<string, string>();
  for (const t of TELEPHONES) {
    const cle = `${t.marque} ${t.modele}`;
    if (!modeles.has(cle)) {
      const modele = await prisma.modele.create({
        data: { commerceId, marqueId: marques.get(t.marque)!, nom: t.modele },
      });
      modeles.set(cle, modele.id);
    }
  }

  // Fournisseurs et clients.
  const fournisseurs = [];
  for (const f of FOURNISSEURS) {
    fournisseurs.push(await prisma.fournisseur.create({ data: { ...f, commerceId } }));
  }
  await prisma.client.createMany({
    data: CLIENTS.map((c, i) => ({
      commerceId,
      nom: c.nom,
      telephone: c.telephone,
      type: c.type,
      plafondCredit: c.plafondCredit,
      typePiece: TypePiece.CNI,
      numeroPiece: `GN-CNI-${String(100200 + i)}`,
      adresse: 'Conakry',
    })),
  });

  // Téléphones : un bon d'achat reçu chez le premier fournisseur, 3 IMEI par variante.
  const achatTelephones = await prisma.achat.create({
    data: {
      commerceId,
      boutiqueId,
      fournisseurId: fournisseurs[0].id,
      numero: 'ACH-0001',
      statut: 'RECU',
      note: 'Stock initial (données de démonstration)',
    },
  });
  let totalTelephones = 0;
  let numeroImei = 0;
  for (const t of TELEPHONES) {
    const produit = await prisma.produit.create({
      data: {
        commerceId,
        type: 'TELEPHONE',
        categorieId: categorieTelephones.id,
        marqueId: marques.get(t.marque),
        modeleId: modeles.get(`${t.marque} ${t.modele}`),
        nom: `${t.marque} ${t.modele} ${t.capacite} ${t.couleur}`,
        capacite: t.capacite,
        couleur: t.couleur,
        garantieMois: t.marque === 'Apple' || t.marque === 'Samsung' ? 12 : 6,
        prixAchat: t.prixAchat,
        prixDetail: t.prixDetail,
        prixGros: t.prixGros,
        seuilGros: 5,
      },
    });
    const ligne = await prisma.ligneAchat.create({
      data: {
        achatId: achatTelephones.id,
        produitId: produit.id,
        quantite: IMEI_PAR_VARIANTE,
        quantiteRecue: IMEI_PAR_VARIANTE,
        prixAchat: t.prixAchat,
      },
    });
    totalTelephones += t.prixAchat * IMEI_PAR_VARIANTE;
    const articles = Array.from({ length: IMEI_PAR_VARIANTE }, () => ({
      id: randomUUID(),
      // TAC fictif 35 209900 + numéro de série, clé de Luhn calculée.
      imei: completerImei(`35209900${String(++numeroImei).padStart(6, '0')}`),
    }));
    await prisma.article.createMany({
      data: articles.map((a) => ({
        id: a.id,
        commerceId,
        produitId: produit.id,
        boutiqueId,
        imei: a.imei,
        prixAchat: t.prixAchat,
        ligneAchatId: ligne.id,
      })),
    });
    await prisma.stock.create({
      data: { produitId: produit.id, boutiqueId, quantite: IMEI_PAR_VARIANTE, seuilMinimum: 2 },
    });
    await prisma.mouvementStock.createMany({
      data: articles.map((a) => ({
        commerceId,
        boutiqueId,
        produitId: produit.id,
        articleId: a.id,
        type: 'ACHAT' as const,
        quantite: 1,
        referenceType: 'Achat',
        referenceId: achatTelephones.id,
      })),
    });
  }
  await prisma.achat.update({
    where: { id: achatTelephones.id },
    data: { montantTotal: totalTelephones, montantPaye: totalTelephones },
  });

  // Accessoires : un bon d'achat reçu chez le troisième fournisseur, payé en partie.
  const achatAccessoires = await prisma.achat.create({
    data: {
      commerceId,
      boutiqueId,
      fournisseurId: fournisseurs[2].id,
      numero: 'ACH-0002',
      statut: 'RECU',
      note: 'Stock initial (données de démonstration)',
    },
  });
  let totalAccessoires = 0;
  for (const [i, a] of ACCESSOIRES.entries()) {
    const produit = await prisma.produit.create({
      data: {
        commerceId,
        type: 'ACCESSOIRE',
        categorieId: categories.get(a.categorie)!,
        marqueId: a.marque ? marques.get(a.marque) : undefined,
        nom: a.nom,
        codeBarres: `620000${String(1000 + i).padStart(7, '0')}`,
        garantieMois:
          a.categorie === 'Batteries externes' || a.categorie === 'Écouteurs et casques' ? 3 : 0,
        prixAchat: a.prixAchat,
        prixDetail: a.prixDetail,
        prixGros: a.prixGros,
        seuilGros: 10,
        compatibilites: a.compatibles
          ? { create: a.compatibles.map((m) => ({ modeleId: modeles.get(m)! })) }
          : undefined,
      },
    });
    await prisma.ligneAchat.create({
      data: {
        achatId: achatAccessoires.id,
        produitId: produit.id,
        quantite: a.quantite,
        quantiteRecue: a.quantite,
        prixAchat: a.prixAchat,
      },
    });
    totalAccessoires += a.prixAchat * a.quantite;
    await prisma.stock.create({
      data: { produitId: produit.id, boutiqueId, quantite: a.quantite, seuilMinimum: 5 },
    });
    await prisma.mouvementStock.create({
      data: {
        commerceId,
        boutiqueId,
        produitId: produit.id,
        type: 'ACHAT',
        quantite: a.quantite,
        referenceType: 'Achat',
        referenceId: achatAccessoires.id,
      },
    });
  }
  await prisma.achat.update({
    where: { id: achatAccessoires.id },
    data: { montantTotal: totalAccessoires, montantPaye: Math.round(totalAccessoires / 2) },
  });

  console.log(
    `Données de démonstration créées : ${comptes.length} comptes (${comptes.map((c) => c.identifiant).join(', ')}, PIN 1234), ` +
      `${TELEPHONES.length + ACCESSOIRES.length} produits, ${numeroImei} IMEI, ${CLIENTS.length} clients, ${FOURNISSEURS.length} fournisseurs.`,
  );
}

main()
  .catch((erreur: unknown) => {
    console.error(erreur);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
