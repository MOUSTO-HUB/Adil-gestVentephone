import { randomInt } from 'node:crypto';
import type { DocumentVente, MoyenPaiement } from '@gestvente/commun';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Tx } from '../sync/journal.service.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const LONGUEUR_CODE = 10;

/** Code court et imprévisible (57^10 possibilités) du lien public d'une facture. */
export const nouveauCode = () =>
  Array.from({ length: LONGUEUR_CODE }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export const codeValide = (code: string) =>
  new RegExp(`^[${ALPHABET}]{${LONGUEUR_CODE}}$`).test(code);

/** Lien public de la facture (créé au premier envoi), à mettre dans un SMS ou WhatsApp. */
export async function lienFacture(tx: Tx, venteId: string, urlPublique: string): Promise<string> {
  const vente = await tx.vente.findUniqueOrThrow({
    where: { id: venteId },
    select: { codePublic: true },
  });
  let code = vente.codePublic;
  if (!code) {
    code = nouveauCode();
    await tx.vente.update({ where: { id: venteId }, data: { codePublic: code } });
  }
  return `${urlPublique.replace(/\/$/, '')}/api/f/${code}`;
}

/** Données de la facture (même mise en page que l'impression sur l'appareil). */
export async function documentVente(
  prisma: PrismaService,
  code: string,
): Promise<DocumentVente | null> {
  const vente = await prisma.vente.findUnique({
    where: { codePublic: code },
    include: {
      commerce: true,
      boutique: true,
      client: true,
      paiements: true,
      lignes: {
        include: { produit: true, article: { select: { imei: true } } },
        orderBy: { produit: { nom: 'asc' } },
      },
    },
  });
  if (!vente) return null;
  return {
    commerce: vente.commerce.nom,
    boutique: {
      nom: vente.boutique.nom,
      adresse: vente.boutique.adresse,
      telephone: vente.boutique.telephone,
    },
    numero: vente.numero,
    dateVente: vente.dateVente.toISOString(),
    statut: vente.statut,
    client: vente.client ? { nom: vente.client.nom, telephone: vente.client.telephone } : null,
    lignes: vente.lignes.map((l) => ({
      designation: l.produit.nom,
      imei: l.article?.imei ?? null,
      quantite: l.quantite,
      tarif: l.tarif,
      prixUnitaire: Number(l.prixUnitaire),
      total: Number(l.total),
      garantieMois: l.produit.garantieMois,
      finGarantie: l.finGarantie?.toISOString() ?? null,
    })),
    sousTotal: Number(vente.sousTotal),
    remise: Number(vente.remise),
    reprise: Number(vente.reprise),
    total: Number(vente.total),
    montantPaye: Number(vente.montantPaye),
    renduMonnaie: Number(vente.renduMonnaie),
    paiements: vente.paiements.map((p) => ({
      moyen: p.moyen as MoyenPaiement,
      montant: Number(p.montant),
      reference: p.reference,
    })),
    monnaie: vente.commerce.monnaie,
    fuseau: vente.commerce.fuseau,
  };
}
