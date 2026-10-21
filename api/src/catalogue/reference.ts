/**
 * Catalogue de base de la plateforme : téléphones et accessoires courants chez les
 * vendeurs de Guinée. Copié dans chaque commerce à sa création (puis modifiable par le
 * commerçant) ; versionné avec le code, il est présent à chaque déploiement.
 * Prix de détail indicatifs en GNF (marché de Conakry, octobre 2026), sans photo.
 */

export interface TelephoneReference {
  marque: string;
  modele: string;
  /** Capacité et prix de détail indicatif de chaque variante (null : téléphone basique). */
  variantes: [capacite: string | null, prixDetail: number][];
  categorie?: string;
}

export interface AccessoireReference {
  categorie: string;
  nom: string;
  prixDetail: number;
  marque?: string;
  /** Modèles compatibles, « Marque Modèle » (ex. « iPhone 13 Pro »). */
  compatibles?: string[];
  garantieMois?: number;
}

export const CATEGORIES_REFERENCE: { nom: string; type: 'TELEPHONE' | 'ACCESSOIRE' }[] = [
  { nom: 'Smartphones', type: 'TELEPHONE' },
  { nom: 'Téléphones basiques', type: 'TELEPHONE' },
  { nom: 'Coques et anticasse', type: 'ACCESSOIRE' },
  { nom: 'Protège-écrans', type: 'ACCESSOIRE' },
  { nom: 'Chargeurs', type: 'ACCESSOIRE' },
  { nom: 'Câbles', type: 'ACCESSOIRE' },
  { nom: 'Écouteurs et casques', type: 'ACCESSOIRE' },
  { nom: 'Batteries externes', type: 'ACCESSOIRE' },
  { nom: 'Cartes mémoire et clés USB', type: 'ACCESSOIRE' },
  { nom: 'Autres accessoires', type: 'ACCESSOIRE' },
];

const G = 1_000;

// prettier-ignore
export const TELEPHONES_REFERENCE: TelephoneReference[] = [
  // iPhone
  { marque: 'iPhone', modele: 'XR', variantes: [['64 Go', 1_900 * G], ['128 Go', 2_200 * G]] },
  { marque: 'iPhone', modele: '11', variantes: [['64 Go', 2_600 * G], ['128 Go', 3_000 * G]] },
  { marque: 'iPhone', modele: '11 Pro', variantes: [['64 Go', 3_000 * G], ['256 Go', 3_500 * G]] },
  { marque: 'iPhone', modele: '11 Pro Max', variantes: [['64 Go', 3_400 * G], ['256 Go', 3_900 * G]] },
  { marque: 'iPhone', modele: '12', variantes: [['64 Go', 3_200 * G], ['128 Go', 3_600 * G]] },
  { marque: 'iPhone', modele: '12 Pro', variantes: [['128 Go', 4_200 * G], ['256 Go', 4_700 * G]] },
  { marque: 'iPhone', modele: '12 Pro Max', variantes: [['128 Go', 4_800 * G], ['256 Go', 5_300 * G]] },
  { marque: 'iPhone', modele: '13', variantes: [['128 Go', 4_300 * G], ['256 Go', 4_900 * G]] },
  { marque: 'iPhone', modele: '13 Pro', variantes: [['128 Go', 5_500 * G], ['256 Go', 6_100 * G]] },
  { marque: 'iPhone', modele: '13 Pro Max', variantes: [['128 Go', 6_300 * G], ['256 Go', 6_900 * G]] },
  { marque: 'iPhone', modele: '14', variantes: [['128 Go', 5_300 * G], ['256 Go', 5_900 * G]] },
  { marque: 'iPhone', modele: '14 Pro', variantes: [['128 Go', 6_800 * G], ['256 Go', 7_500 * G]] },
  { marque: 'iPhone', modele: '14 Pro Max', variantes: [['128 Go', 7_800 * G], ['256 Go', 8_500 * G]] },
  { marque: 'iPhone', modele: '15', variantes: [['128 Go', 6_500 * G], ['256 Go', 7_300 * G]] },
  { marque: 'iPhone', modele: '15 Pro', variantes: [['128 Go', 8_200 * G], ['256 Go', 9_000 * G]] },
  { marque: 'iPhone', modele: '15 Pro Max', variantes: [['256 Go', 9_800 * G], ['512 Go', 11_000 * G]] },
  { marque: 'iPhone', modele: '16', variantes: [['128 Go', 8_000 * G], ['256 Go', 8_900 * G]] },
  { marque: 'iPhone', modele: '16 Pro', variantes: [['128 Go', 10_000 * G], ['256 Go', 11_000 * G]] },
  { marque: 'iPhone', modele: '16 Pro Max', variantes: [['256 Go', 11_800 * G], ['512 Go', 13_500 * G]] },
  { marque: 'iPhone', modele: '17', variantes: [['256 Go', 9_500 * G]] },
  { marque: 'iPhone', modele: 'Air', variantes: [['256 Go', 12_000 * G]] },
  { marque: 'iPhone', modele: '17 Pro', variantes: [['256 Go', 12_500 * G]] },
  { marque: 'iPhone', modele: '17 Pro Max', variantes: [['256 Go', 14_000 * G], ['512 Go', 16_000 * G]] },
  { marque: 'iPhone', modele: '18', variantes: [['256 Go', 11_000 * G]] },
  { marque: 'iPhone', modele: '18 Pro', variantes: [['256 Go', 14_500 * G]] },
  { marque: 'iPhone', modele: '18 Pro Max', variantes: [['256 Go', 16_500 * G], ['512 Go', 18_500 * G]] },
  // Samsung
  { marque: 'Samsung', modele: 'A05', variantes: [['64 Go', 950 * G]] },
  { marque: 'Samsung', modele: 'A06', variantes: [['64 Go', 1_000 * G]] },
  { marque: 'Samsung', modele: 'A10', variantes: [['32 Go', 900 * G]] },
  { marque: 'Samsung', modele: 'A12', variantes: [['64 Go', 1_100 * G]] },
  { marque: 'Samsung', modele: 'A14', variantes: [['128 Go', 1_350 * G]] },
  { marque: 'Samsung', modele: 'A15', variantes: [['128 Go', 1_500 * G]] },
  { marque: 'Samsung', modele: 'A16', variantes: [['128 Go', 1_650 * G]] },
  { marque: 'Samsung', modele: 'A25', variantes: [['128 Go', 2_000 * G]] },
  { marque: 'Samsung', modele: 'A26', variantes: [['128 Go', 2_100 * G]] },
  { marque: 'Samsung', modele: 'A35', variantes: [['128 Go', 2_600 * G]] },
  { marque: 'Samsung', modele: 'A36', variantes: [['256 Go', 2_900 * G]] },
  { marque: 'Samsung', modele: 'A54', variantes: [['128 Go', 2_800 * G]] },
  { marque: 'Samsung', modele: 'A55', variantes: [['256 Go', 3_200 * G]] },
  { marque: 'Samsung', modele: 'A56', variantes: [['256 Go', 3_500 * G]] },
  { marque: 'Samsung', modele: 'S10 Plus', variantes: [['128 Go', 2_200 * G]] },
  { marque: 'Samsung', modele: 'S20 Ultra', variantes: [['128 Go', 3_000 * G]] },
  { marque: 'Samsung', modele: 'S21 Ultra', variantes: [['256 Go', 3_900 * G]] },
  { marque: 'Samsung', modele: 'S22 Ultra', variantes: [['256 Go', 4_800 * G]] },
  { marque: 'Samsung', modele: 'S23', variantes: [['128 Go', 4_500 * G]] },
  { marque: 'Samsung', modele: 'S23 Ultra', variantes: [['256 Go', 6_500 * G]] },
  { marque: 'Samsung', modele: 'S24', variantes: [['256 Go', 6_200 * G]] },
  { marque: 'Samsung', modele: 'S24 Ultra', variantes: [['256 Go', 8_500 * G]] },
  { marque: 'Samsung', modele: 'S25', variantes: [['256 Go', 7_800 * G]] },
  { marque: 'Samsung', modele: 'S25 Ultra', variantes: [['256 Go', 10_500 * G]] },
  { marque: 'Samsung', modele: 'Note 10 Plus', variantes: [['256 Go', 2_600 * G]] },
  { marque: 'Samsung', modele: 'Note 20 Ultra', variantes: [['256 Go', 3_600 * G]] },
  { marque: 'Samsung', modele: 'Z Flip 6', variantes: [['256 Go', 8_000 * G]] },
  { marque: 'Samsung', modele: 'Z Fold 6', variantes: [['256 Go', 14_000 * G]] },
  // Tecno
  { marque: 'Tecno', modele: 'Pop 8', variantes: [['64 Go', 700 * G]] },
  { marque: 'Tecno', modele: 'Pop 9', variantes: [['64 Go', 750 * G]] },
  { marque: 'Tecno', modele: 'Spark 10', variantes: [['128 Go', 1_000 * G]] },
  { marque: 'Tecno', modele: 'Spark 20', variantes: [['128 Go', 1_250 * G]] },
  { marque: 'Tecno', modele: 'Spark 20 Pro', variantes: [['256 Go', 1_550 * G]] },
  { marque: 'Tecno', modele: 'Spark 30', variantes: [['128 Go', 1_350 * G]] },
  { marque: 'Tecno', modele: 'Spark 40', variantes: [['128 Go', 1_450 * G]] },
  { marque: 'Tecno', modele: 'Camon 15', variantes: [['64 Go', 1_000 * G]] },
  { marque: 'Tecno', modele: 'Camon 20', variantes: [['256 Go', 1_700 * G]] },
  { marque: 'Tecno', modele: 'Camon 30', variantes: [['256 Go', 2_200 * G]] },
  { marque: 'Tecno', modele: 'Camon 40', variantes: [['256 Go', 2_600 * G]] },
  { marque: 'Tecno', modele: 'Pova 6', variantes: [['256 Go', 1_900 * G]] },
  { marque: 'Tecno', modele: 'Phantom V Flip', variantes: [['256 Go', 4_500 * G]] },
  // Itel
  { marque: 'Itel', modele: 'A50', variantes: [['64 Go', 600 * G]] },
  { marque: 'Itel', modele: 'A70', variantes: [['64 Go', 650 * G]] },
  { marque: 'Itel', modele: 'A80', variantes: [['128 Go', 750 * G]] },
  { marque: 'Itel', modele: 'P55', variantes: [['128 Go', 900 * G]] },
  { marque: 'Itel', modele: 'P65', variantes: [['256 Go', 1_050 * G]] },
  { marque: 'Itel', modele: 'S23', variantes: [['128 Go', 950 * G]] },
  { marque: 'Itel', modele: 'S24', variantes: [['256 Go', 1_150 * G]] },
  { marque: 'Itel', modele: 'Vision 3', variantes: [['64 Go', 700 * G]] },
  { marque: 'Itel', modele: 'it2163', variantes: [[null, 120 * G]], categorie: 'Téléphones basiques' },
  { marque: 'Itel', modele: 'it5626', variantes: [[null, 160 * G]], categorie: 'Téléphones basiques' },
  // Infinix
  { marque: 'Infinix', modele: 'Smart 8', variantes: [['64 Go', 750 * G]] },
  { marque: 'Infinix', modele: 'Smart 9', variantes: [['128 Go', 850 * G]] },
  { marque: 'Infinix', modele: 'Hot 40i', variantes: [['128 Go', 1_050 * G]] },
  { marque: 'Infinix', modele: 'Hot 40', variantes: [['256 Go', 1_300 * G]] },
  { marque: 'Infinix', modele: 'Hot 50i', variantes: [['128 Go', 1_150 * G]] },
  { marque: 'Infinix', modele: 'Hot 50', variantes: [['256 Go', 1_450 * G]] },
  { marque: 'Infinix', modele: 'Note 30', variantes: [['256 Go', 1_700 * G]] },
  { marque: 'Infinix', modele: 'Note 40', variantes: [['256 Go', 2_000 * G]] },
  { marque: 'Infinix', modele: 'Note 40 Pro', variantes: [['256 Go', 2_400 * G]] },
  { marque: 'Infinix', modele: 'Zero 30', variantes: [['256 Go', 2_900 * G]] },
  // Xiaomi
  { marque: 'Xiaomi', modele: 'Redmi A3', variantes: [['64 Go', 750 * G]] },
  { marque: 'Xiaomi', modele: 'Redmi 13C', variantes: [['128 Go', 1_050 * G]] },
  { marque: 'Xiaomi', modele: 'Redmi 14C', variantes: [['128 Go', 1_150 * G]] },
  { marque: 'Xiaomi', modele: 'Redmi Note 13', variantes: [['128 Go', 1_700 * G]] },
  { marque: 'Xiaomi', modele: 'Redmi Note 13 Pro', variantes: [['256 Go', 2_500 * G]] },
  { marque: 'Xiaomi', modele: 'Redmi Note 14', variantes: [['128 Go', 1_900 * G]] },
  { marque: 'Xiaomi', modele: 'Poco X6', variantes: [['256 Go', 2_400 * G]] },
  // Oppo
  { marque: 'Oppo', modele: 'A18', variantes: [['64 Go', 950 * G]] },
  { marque: 'Oppo', modele: 'A38', variantes: [['128 Go', 1_200 * G]] },
  { marque: 'Oppo', modele: 'A58', variantes: [['128 Go', 1_500 * G]] },
  // Téléphones basiques
  { marque: 'Nokia', modele: '105', variantes: [[null, 150 * G]], categorie: 'Téléphones basiques' },
  { marque: 'Nokia', modele: '106', variantes: [[null, 170 * G]], categorie: 'Téléphones basiques' },
  { marque: 'Nokia', modele: '110', variantes: [[null, 190 * G]], categorie: 'Téléphones basiques' },
  { marque: 'Nokia', modele: '3310', variantes: [[null, 250 * G]], categorie: 'Téléphones basiques' },
];

/** Modèles qui ont leur coque anticasse et leur verre trempé au catalogue. */
// prettier-ignore
const MODELES_PROTEGES: [modele: string, coque: number, verre: number][] = [
  ['iPhone 11', 30 * G, 15 * G], ['iPhone 11 Pro', 30 * G, 15 * G], ['iPhone 11 Pro Max', 35 * G, 20 * G],
  ['iPhone 12', 35 * G, 15 * G], ['iPhone 12 Pro', 35 * G, 15 * G], ['iPhone 12 Pro Max', 40 * G, 20 * G],
  ['iPhone 13', 35 * G, 15 * G], ['iPhone 13 Pro', 40 * G, 20 * G], ['iPhone 13 Pro Max', 40 * G, 20 * G],
  ['iPhone 14', 40 * G, 20 * G], ['iPhone 14 Pro', 45 * G, 20 * G], ['iPhone 14 Pro Max', 45 * G, 25 * G],
  ['iPhone 15', 45 * G, 20 * G], ['iPhone 15 Pro', 50 * G, 25 * G], ['iPhone 15 Pro Max', 50 * G, 25 * G],
  ['iPhone 16', 50 * G, 25 * G], ['iPhone 16 Pro', 55 * G, 25 * G], ['iPhone 16 Pro Max', 55 * G, 30 * G],
  ['iPhone 17 Pro Max', 60 * G, 30 * G],
  ['Samsung A05', 25 * G, 15 * G], ['Samsung A10', 20 * G, 15 * G], ['Samsung A12', 25 * G, 15 * G],
  ['Samsung A14', 25 * G, 15 * G], ['Samsung A15', 25 * G, 15 * G], ['Samsung A25', 30 * G, 15 * G],
  ['Samsung A35', 30 * G, 20 * G], ['Samsung A55', 35 * G, 20 * G], ['Samsung S10 Plus', 30 * G, 25 * G],
  ['Samsung S21 Ultra', 35 * G, 30 * G], ['Samsung S22 Ultra', 40 * G, 30 * G],
  ['Samsung S23 Ultra', 45 * G, 35 * G], ['Samsung S24 Ultra', 50 * G, 35 * G],
  ['Samsung Note 20 Ultra', 40 * G, 30 * G],
  ['Tecno Spark 20', 25 * G, 15 * G], ['Tecno Camon 20', 25 * G, 15 * G], ['Tecno Camon 30', 30 * G, 15 * G],
  ['Infinix Hot 40', 25 * G, 15 * G], ['Infinix Note 40', 25 * G, 15 * G],
  ['Itel A70', 20 * G, 10 * G], ['Xiaomi Redmi Note 13', 25 * G, 15 * G],
];

// prettier-ignore
const ACCESSOIRES_GENERAUX: AccessoireReference[] = [
  { categorie: 'Chargeurs', nom: 'Chargeur iPhone 20 W USB-C', prixDetail: 75 * G, marque: 'iPhone', garantieMois: 1 },
  { categorie: 'Chargeurs', nom: 'Chargeur Samsung 25 W USB-C', prixDetail: 90 * G, marque: 'Samsung', garantieMois: 1 },
  { categorie: 'Chargeurs', nom: 'Chargeur rapide USB 18 W', prixDetail: 35 * G, garantieMois: 1 },
  { categorie: 'Chargeurs', nom: 'Chargeur Micro-USB 10 W', prixDetail: 25 * G },
  { categorie: 'Chargeurs', nom: 'Chargeur voiture double USB', prixDetail: 40 * G },
  { categorie: 'Câbles', nom: 'Câble USB-C vers USB-C 1 m', prixDetail: 25 * G },
  { categorie: 'Câbles', nom: 'Câble USB vers USB-C 1 m', prixDetail: 20 * G },
  { categorie: 'Câbles', nom: 'Câble Lightning iPhone 1 m', prixDetail: 25 * G, marque: 'iPhone' },
  { categorie: 'Câbles', nom: 'Câble Micro-USB 1 m', prixDetail: 15 * G },
  { categorie: 'Écouteurs et casques', nom: 'Écouteurs filaires jack 3,5 mm', prixDetail: 20 * G },
  { categorie: 'Écouteurs et casques', nom: 'Écouteurs filaires USB-C', prixDetail: 35 * G },
  { categorie: 'Écouteurs et casques', nom: 'Écouteurs sans fil type AirPods Pro', prixDetail: 150 * G, garantieMois: 1 },
  { categorie: 'Écouteurs et casques', nom: 'Écouteurs Oraimo FreePods 4', prixDetail: 250 * G, marque: 'Oraimo', garantieMois: 3 },
  { categorie: 'Écouteurs et casques', nom: 'Casque Bluetooth P47', prixDetail: 60 * G, garantieMois: 1 },
  { categorie: 'Écouteurs et casques', nom: 'Casque Bluetooth JBL Tune 510BT', prixDetail: 350 * G, marque: 'JBL', garantieMois: 3 },
  { categorie: 'Batteries externes', nom: 'Batterie externe Oraimo 10 000 mAh', prixDetail: 150 * G, marque: 'Oraimo', garantieMois: 3 },
  { categorie: 'Batteries externes', nom: 'Batterie externe Oraimo 20 000 mAh', prixDetail: 220 * G, marque: 'Oraimo', garantieMois: 3 },
  { categorie: 'Batteries externes', nom: 'Batterie externe 10 000 mAh', prixDetail: 100 * G, garantieMois: 1 },
  { categorie: 'Cartes mémoire et clés USB', nom: 'Carte mémoire microSD 32 Go', prixDetail: 50 * G },
  { categorie: 'Cartes mémoire et clés USB', nom: 'Carte mémoire microSD 64 Go', prixDetail: 80 * G },
  { categorie: 'Cartes mémoire et clés USB', nom: 'Carte mémoire microSD 128 Go', prixDetail: 130 * G },
  { categorie: 'Cartes mémoire et clés USB', nom: 'Clé USB 32 Go', prixDetail: 60 * G },
  { categorie: 'Autres accessoires', nom: 'Haut-parleur Bluetooth JBL Go 3', prixDetail: 250 * G, marque: 'JBL', garantieMois: 3 },
  { categorie: 'Autres accessoires', nom: 'Montre connectée T800 Ultra', prixDetail: 200 * G, garantieMois: 1 },
  { categorie: 'Autres accessoires', nom: 'Support téléphone voiture', prixDetail: 40 * G },
  { categorie: 'Autres accessoires', nom: 'Perche à selfie Bluetooth', prixDetail: 35 * G },
  { categorie: 'Autres accessoires', nom: 'Anneau de lumière (ring light) 26 cm', prixDetail: 120 * G },
];

export const ACCESSOIRES_REFERENCE: AccessoireReference[] = [
  ...MODELES_PROTEGES.flatMap(([modele, coque, verre]): AccessoireReference[] => [
    {
      categorie: 'Coques et anticasse',
      nom: `Anticasse ${modele}`,
      prixDetail: coque,
      compatibles: [modele],
    },
    {
      categorie: 'Protège-écrans',
      nom: `Protège-écran verre trempé ${modele}`,
      prixDetail: verre,
      compatibles: [modele],
    },
  ]),
  ...ACCESSOIRES_GENERAUX,
];

/** Garantie par défaut des téléphones neufs (modifiable par produit). */
export const GARANTIE_TELEPHONE_MOIS = 3;

/** Prix de gros (−5 %) et coût d'achat indicatif (−15 %), arrondis au millier. */
export const prixDerives = (detail: number) => ({
  prixGros: Math.round((detail * 0.95) / G) * G,
  prixAchat: Math.round((detail * 0.85) / G) * G,
});

export const nomTelephone = (t: TelephoneReference, capacite: string | null) =>
  [t.marque, t.modele, capacite].filter(Boolean).join(' ');
