import { describe, expect, it } from 'vitest';
import {
  apresRappel,
  type EcheanceRappel,
  PARAMETRES_RAPPELS_DEFAUT,
  penaliteDue,
  prochainRappel,
  rappelDu,
  schemaParametresRappels,
} from './rappels.js';

const P = { joursAvant: 3, relancesMax: 2 };
const tranche = (
  numero: number,
  dateEcheance: string,
  surcharge: Partial<EcheanceRappel> = {},
): EcheanceRappel => ({
  numero,
  dateEcheance,
  montant: 500_000,
  montantPaye: 0,
  penalite: 0,
  dernierRappel: null,
  nombreRelances: 0,
  ...surcharge,
});

/** Simule la tâche quotidienne du premier au dernier jour : jours et types envoyés. */
function simuler(echeances: EcheanceRappel[], du: string, jours: number) {
  let etat = echeances;
  const envois: string[] = [];
  for (let i = 0; i < jours; i++) {
    const jour = new Date(Date.parse(`${du}T00:00:00Z`) + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const r = rappelDu(etat, jour, P);
    if (r) {
      envois.push(`${jour} ${r.type} ${r.montant}`);
      etat = apresRappel(etat, r, jour);
    }
  }
  return envois;
}

describe('calendrier des rappels', () => {
  it('3 jours avant, le jour même, puis une relance tous les 7 jours (au plus 2)', () => {
    expect(simuler([tranche(1, '2026-11-21')], '2026-11-10', 40)).toEqual([
      '2026-11-18 AVANT 500000',
      '2026-11-21 JOUR 500000',
      '2026-11-22 RETARD 500000',
      '2026-11-29 RETARD 500000',
    ]);
  });

  it('rien pour une tranche payée ; une relance couvre toutes les tranches échues', () => {
    expect(
      rappelDu([tranche(1, '2026-11-21', { montantPaye: 500_000 })], '2026-11-21', P),
    ).toBeNull();
    expect(
      rappelDu(
        [tranche(1, '2026-10-21'), tranche(2, '2026-11-21', { montantPaye: 100_000 })],
        '2026-11-25',
        P,
      ),
    ).toEqual({ type: 'RETARD', numero: 1, dateEcheance: '2026-10-21', montant: 900_000 });
  });

  it('tâche manquée : le rappel avant est rattrapé, une seule fois', () => {
    const t = [tranche(1, '2026-11-21')];
    expect(rappelDu(t, '2026-11-20', P)?.type).toBe('AVANT');
    expect(
      rappelDu(apresRappel(t, rappelDu(t, '2026-11-20', P)!, '2026-11-20'), '2026-11-20', P),
    ).toBeNull();
  });

  it('sans rappel avant (0 jour), et prochain rappel affiché sur la fiche', () => {
    const t = [tranche(1, '2026-11-21')];
    expect(rappelDu(t, '2026-11-19', { joursAvant: 0, relancesMax: 2 })).toBeNull();
    expect(prochainRappel(t, '2026-11-01', P)).toEqual({
      jour: '2026-11-18',
      rappel: { type: 'AVANT', numero: 1, dateEcheance: '2026-11-21', montant: 500_000 },
    });
    const relancee = [tranche(1, '2026-11-21', { dernierRappel: '2026-11-22', nombreRelances: 1 })];
    expect(prochainRappel(relancee, '2026-11-23', P)?.jour).toBe('2026-11-29');
    const epuisee = [tranche(1, '2026-11-21', { dernierRappel: '2026-11-29', nombreRelances: 2 })];
    expect(prochainRappel(epuisee, '2026-12-01', P)).toBeNull();
  });
});

describe('pénalité de retard', () => {
  const actif = {
    ...PARAMETRES_RAPPELS_DEFAUT,
    penaliteActive: true,
    penaliteType: 'POURCENTAGE' as const,
    penaliteValeur: 5,
    penaliteGrace: 3,
  };

  it('après le délai de grâce, une seule fois par tranche', () => {
    const t = tranche(1, '2026-11-21');
    expect(penaliteDue(t, '2026-11-24', actif)).toBe(0);
    expect(penaliteDue(t, '2026-11-25', actif)).toBe(25_000);
    expect(penaliteDue({ ...t, penalite: 25_000 }, '2026-12-25', actif)).toBe(0);
    expect(
      penaliteDue(t, '2026-11-25', { ...actif, penaliteType: 'FIXE', penaliteValeur: 10_000 }),
    ).toBe(10_000);
  });

  it('désactivée, ou tranche payée : aucune pénalité', () => {
    const t = tranche(1, '2026-11-21');
    expect(penaliteDue(t, '2026-12-25', { ...actif, penaliteActive: false })).toBe(0);
    expect(penaliteDue({ ...t, montantPaye: 500_000 }, '2026-12-25', actif)).toBe(0);
  });

  it('paramètres contrôlés', () => {
    expect(schemaParametresRappels.safeParse(actif).success).toBe(true);
    expect(schemaParametresRappels.safeParse({ ...actif, penaliteValeur: 150 }).success).toBe(
      false,
    );
    expect(schemaParametresRappels.safeParse({ ...actif, penaliteValeur: 0 }).success).toBe(false);
  });
});
