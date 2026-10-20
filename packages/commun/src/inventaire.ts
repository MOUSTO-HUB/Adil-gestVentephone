import { z } from 'zod';
import { normaliserImei } from './imei.js';

/** Inventaire physique : comptage, écarts et ajustements. */

export const schemaInventaire = z.object({
  id: z.uuid(),
  motif: z.string().trim().min(3, 'Motif obligatoire (ex. inventaire de fin de mois).').max(200),
  lignes: z
    .array(
      z.object({
        produitId: z.uuid(),
        /** Accessoires : quantité comptée. */
        quantiteComptee: z.number().int().min(0).optional(),
        /** Téléphones : IMEI scannés en rayon. */
        imeis: z.array(z.string()).max(5000).optional(),
      }),
    )
    .min(1, 'Comptez au moins un produit.')
    .max(2000),
});
export type InventaireSaisi = z.infer<typeof schemaInventaire>;

/** Écart d'un accessoire : positif = surplus trouvé, négatif = manque. */
export const ecartQuantite = (theorique: number, comptee: number) => comptee - theorique;

export interface EcartsTelephones<A extends { imei: string }> {
  /** En stock selon le système mais non scannés : manquants. */
  manquants: A[];
  /** Scannés et bien en stock. */
  presents: A[];
  /** Scannés mais absents du stock de la boutique (vendus, ailleurs, inconnus). */
  inconnus: string[];
}

/** Compare les téléphones en stock à ceux scannés pendant l'inventaire. */
export function ecartsTelephones<A extends { imei: string }>(
  enStock: A[],
  scannes: string[],
): EcartsTelephones<A> {
  const lus = new Set(scannes.map(normaliserImei));
  const connus = new Set(enStock.map((a) => a.imei));
  return {
    manquants: enStock.filter((a) => !lus.has(a.imei)),
    presents: enStock.filter((a) => lus.has(a.imei)),
    inconnus: [...lus].filter((imei) => !connus.has(imei)),
  };
}
