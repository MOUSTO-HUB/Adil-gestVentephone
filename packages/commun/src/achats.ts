import { z } from 'zod';
import { imeiValide, normaliserImei } from './imei.js';
import { MOYENS_REMBOURSEMENT } from './ventes.js';

/**
 * Bons d'achat fournisseur, réception (quantité ; IMEI des téléphones facultatifs),
 * paiements (mode et référence) et seuils de stock.
 */

const montant = z.number().int('Montant entier attendu.');

export const schemaLigneAchat = z.object({
  id: z.uuid(),
  produitId: z.uuid(),
  quantite: z.number().int().min(1, 'Quantité d’au moins 1.').max(10_000),
  prixAchat: montant.min(0),
});

export const schemaAchat = z
  .object({
    id: z.uuid(),
    fournisseurId: z.uuid(),
    /** Numéro du bon, donné par l'appareil (préfixe de la boutique, date, suffixe). */
    numero: z.string().trim().min(3).max(30),
    dateAchat: z.iso.date(),
    note: z.string().trim().max(500).nullable(),
    lignes: z.array(schemaLigneAchat).min(1, 'Ajoutez au moins un produit.').max(200),
  })
  .refine((a) => new Set(a.lignes.map((l) => l.produitId)).size === a.lignes.length, {
    path: ['lignes'],
    message: 'Un produit figure deux fois sur le bon : regroupez les quantités.',
  });
export type AchatSaisi = z.infer<typeof schemaAchat>;

export const schemaReception = z.object({
  achatId: z.uuid(),
  lignes: z
    .array(
      z.object({
        ligneId: z.uuid(),
        /** Quantité reçue (téléphones sans IMEI saisi compris). */
        quantite: z.number().int().min(1).optional(),
        /** Téléphones : IMEI facultatifs, un article par IMEI (identifiant donné par l'appareil). */
        articles: z
          .array(z.object({ id: z.uuid(), imei: z.string() }))
          .max(1000)
          .optional(),
      }),
    )
    .min(1, 'Rien à réceptionner.'),
});
export type ReceptionSaisie = z.infer<typeof schemaReception>;

export const schemaPaiementAchat = z.object({
  achatId: z.uuid(),
  montant: montant.min(1, 'Montant positif attendu.'),
  /** Mode de paiement au fournisseur (espèces par défaut). */
  moyen: z.enum(MOYENS_REMBOURSEMENT).optional(),
  /** Référence de la transaction (Orange Money, virement…), si besoin. */
  reference: z.string().trim().max(60).nullable().optional(),
});

/** Paiement au fournisseur, gardé sur le bon. */
export interface PaiementFournisseur {
  date: string;
  montant: number;
  moyen: (typeof MOYENS_REMBOURSEMENT)[number];
  reference: string | null;
}

export const schemaAnnulationAchat = z.object({ achatId: z.uuid() });

export const schemaSeuil = z.object({
  produitId: z.uuid(),
  seuilMinimum: z.number().int().min(0).max(100_000),
});

/** Total d'un bon : somme des quantités × prix d'achat. */
export const totalAchat = (lignes: { quantite: number; prixAchat: number }[]) =>
  lignes.reduce((total, l) => total + l.quantite * l.prixAchat, 0);

export type StatutAchat = 'BROUILLON' | 'PARTIEL' | 'RECU' | 'ANNULE';

/** Statut après réception : rien reçu, une partie, ou tout. */
export function statutApresReception(
  lignes: { quantite: number; quantiteRecue: number }[],
): StatutAchat {
  const recu = lignes.reduce((t, l) => t + l.quantiteRecue, 0);
  if (recu === 0) return 'BROUILLON';
  return lignes.every((l) => l.quantiteRecue >= l.quantite) ? 'RECU' : 'PARTIEL';
}

export interface ControleImeis {
  /** IMEI normalisés, prêts à enregistrer. */
  valides: string[];
  /** Saisies qui ne sont pas des IMEI (longueur, clé de Luhn). */
  invalides: string[];
  /** Saisis deux fois dans cette réception. */
  doublons: string[];
  /** Déjà connus du commerce (en stock, vendus…). */
  dejaConnus: string[];
}

/** Contrôle d'une série d'IMEI saisis ou scannés en rafale. */
export function controlerImeis(
  saisies: string[],
  connus: (imei: string) => boolean,
): ControleImeis {
  const resultat: ControleImeis = { valides: [], invalides: [], doublons: [], dejaConnus: [] };
  const vus = new Set<string>();
  for (const saisie of saisies) {
    const imei = normaliserImei(saisie);
    if (!imeiValide(imei)) resultat.invalides.push(saisie);
    else if (vus.has(imei)) resultat.doublons.push(imei);
    else if (connus(imei)) resultat.dejaConnus.push(imei);
    else resultat.valides.push(imei);
    vus.add(imei);
  }
  return resultat;
}

/** Reçu sur une ligne : jamais plus que commandé. Renvoie le motif du refus, ou null. */
export function erreurReception(
  ligne: { quantite: number; quantiteRecue: number; type: 'TELEPHONE' | 'ACCESSOIRE'; nom: string },
  reception: { quantite?: number; articles?: unknown[] },
): string | null {
  // Quantité reçue ; pour un téléphone, les IMEI sont facultatifs (jamais plus que la quantité).
  const imeis = reception.articles?.length ?? 0;
  const recue =
    ligne.type === 'TELEPHONE' ? (reception.quantite ?? imeis) : (reception.quantite ?? 0);
  if (ligne.type === 'TELEPHONE' && imeis > recue) {
    return `« ${ligne.nom} » : ${imeis} IMEI pour ${recue} téléphone(s) reçu(s).`;
  }
  if (ligne.type === 'ACCESSOIRE' && imeis) {
    return `« ${ligne.nom} » : un accessoire se réceptionne en quantité.`;
  }
  if (recue < 1) return `« ${ligne.nom} » : rien à réceptionner.`;
  const reste = ligne.quantite - ligne.quantiteRecue;
  if (recue > reste) {
    return `« ${ligne.nom} » : ${recue} reçu(s) pour ${reste} attendu(s).`;
  }
  return null;
}

/** Paiement au fournisseur : jamais plus que le reste dû. */
export function erreurPaiementAchat(
  total: number,
  dejaPaye: number,
  montant: number,
): string | null {
  const reste = total - dejaPaye;
  if (montant > reste) return `Le paiement (${montant}) dépasse le reste dû (${reste}).`;
  return null;
}

// ---------------------------------------------------------------- Numéro du bon de commande

/** Deux lettres du nom de l'utilisateur, sans accent, en majuscules (« Abdoul » → AB). */
export function initialesBon(nom: string): string {
  // NFD sépare les accents des lettres ; tout ce qui n'est pas A-Z est ensuite retiré.
  const lettres = nom
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return (lettres + 'XX').slice(0, 2);
}

/** Début commun des numéros d'un utilisateur pour une année : BCAB-2026. */
export const prefixeBonCommande = (nom: string, annee: number) => `BC${initialesBon(nom)}-${annee}`;

/** Numéro du bon de commande : BC + initiales + année + ordre sur 4 chiffres (BCAB-20260001). */
export const numeroBonCommande = (nom: string, annee: number, ordre: number) =>
  `${prefixeBonCommande(nom, annee)}${String(ordre).padStart(4, '0')}`;

/** Numéro suivant, d'après les numéros déjà connus (ordre le plus grand + 1). */
export function prochainNumeroBon(nom: string, annee: number, existants: string[]): string {
  const prefixe = prefixeBonCommande(nom, annee);
  let plusGrand = 0;
  for (const n of existants) {
    if (!n.startsWith(prefixe)) continue;
    const reste = n.slice(prefixe.length);
    if (/^\d+$/.test(reste)) plusGrand = Math.max(plusGrand, Number(reste));
  }
  return numeroBonCommande(nom, annee, plusGrand + 1);
}

/** Partie « BCAB-2026 » d'un numéro au nouveau format, sinon null. */
export function prefixeDuNumero(numero: string): string | null {
  const m = /^(BC[A-Z]{2}-\d{4})\d+$/.exec(numero);
  return m ? m[1]! : null;
}
