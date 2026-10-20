import { describe, expect, it } from 'vitest';
import {
  bilanCaisse,
  ecartsCaisse,
  erreurCloture,
  montantsVides,
  type MouvementsCaisse,
} from './caisse.js';
import { lignesRapportCaisse, rapportCaisseHtml } from './rapport-caisse.js';

const mouvements: MouvementsCaisse = {
  fondInitial: 200_000,
  ventes: [
    // 1 410 000 : 1 500 000 en espèces, 90 000 rendus.
    {
      statut: 'VALIDEE',
      renduMonnaie: 90_000,
      paiements: [{ moyen: 'ESPECES', montant: 1_500_000 }],
    },
    // Paiement mixte avec un avoir (pas de l'argent en caisse).
    {
      statut: 'VALIDEE',
      renduMonnaie: 0,
      paiements: [
        { moyen: 'ORANGE_MONEY', montant: 300_000 },
        { moyen: 'AVOIR', montant: 50_000 },
      ],
    },
    // Vente annulée : rien n'est compté.
    { statut: 'ANNULEE', renduMonnaie: 0, paiements: [{ moyen: 'ESPECES', montant: 999_000 }] },
  ],
  retours: [
    { montantRembourse: 100_000, moyenRemboursement: 'ESPECES' },
    { montantRembourse: 0, moyenRemboursement: null },
  ],
  depenses: [
    { montant: 25_000, moyen: 'ESPECES' },
    { montant: 10_000, moyen: 'ORANGE_MONEY' },
  ],
};

describe('calculs de caisse', () => {
  it('attendu par moyen : fond + encaissé − rendu − remboursé − dépensé', () => {
    const b = bilanCaisse(mouvements);
    expect(b.nombreVentes).toBe(2);
    expect(b.encaisse).toEqual({ ...montantsVides(), ESPECES: 1_410_000, ORANGE_MONEY: 300_000 });
    expect(b.theorique).toEqual({
      ESPECES: 200_000 + 1_410_000 - 100_000 - 25_000,
      ORANGE_MONEY: 290_000,
      MTN_MOMO: 0,
      VIREMENT: 0,
    });
  });

  it('écarts par moyen et total (un excédent ne cache pas un manque)', () => {
    const { theorique } = bilanCaisse(mouvements);
    const comptage = { ...theorique, ESPECES: theorique.ESPECES - 5_000, ORANGE_MONEY: 295_000 };
    const ecarts = ecartsCaisse(theorique, comptage);
    expect(ecarts.parMoyen).toEqual({
      ESPECES: -5_000,
      ORANGE_MONEY: 5_000,
      MTN_MOMO: 0,
      VIREMENT: 0,
    });
    expect(ecarts.total).toBe(0);
    expect(erreurCloture(ecarts.parMoyen, null)).toMatch(/expliquez/);
    expect(erreurCloture(ecarts.parMoyen, 'Paiement OM classé en espèces')).toBeNull();
    expect(erreurCloture(ecartsCaisse(theorique, theorique).parMoyen, null)).toBeNull();
  });

  it('rapport de clôture : ticket 80 mm et PDF', () => {
    const b = bilanCaisse(mouvements);
    const comptage = { ...b.theorique, ESPECES: b.theorique.ESPECES - 5_000 };
    const e = ecartsCaisse(b.theorique, comptage);
    const rapport = {
      commerce: 'Adil Phone',
      boutique: 'Adil Phone Madina',
      vendeur: 'Abdoulaye Kaba',
      statut: 'CLOTUREE' as const,
      ouverteLe: '2026-10-20T08:00:00.000Z',
      clotureeLe: '2026-10-20T19:00:00.000Z',
      fondInitial: 200_000,
      nombreVentes: b.nombreVentes,
      encaisse: b.encaisse,
      rembourse: b.rembourse,
      depense: b.depense,
      theorique: b.theorique,
      comptage,
      ecarts: e.parMoyen,
      ecartTotal: e.total,
      commentaire: 'Billet manquant',
      validePar: null,
      commentaireValidation: null,
      monnaie: 'GNF',
      fuseau: 'Africa/Conakry',
    };
    const lignes = lignesRapportCaisse(rapport, 80);
    expect(Math.max(...lignes.map((l) => l.texte.length))).toBeLessThanOrEqual(48);
    const texte = lignes.map((l) => l.texte).join('\n');
    expect(texte).toMatch(/ÉCART +-5 000 GNF/);
    expect(texte).toContain('En attente de validation');
    expect(texte).not.toContain('MTN');
    expect(rapportCaisseHtml(rapport)).toContain('Billet manquant');
  });
});
