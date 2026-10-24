import { describe, expect, it } from 'vitest';
import {
  avertissementAbonnement,
  etatAbonnement,
  finEssai,
  messageAbonnementExpire,
  prixPeriode,
  prolongation,
} from './abonnements.js';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('abonnements', () => {
  it('prix : base, boutiques supplémentaires, année à 10 mois', () => {
    expect(prixPeriode('MENSUELLE', 1)).toBe(150_000);
    expect(prixPeriode('MENSUELLE', 3)).toBe(250_000);
    expect(prixPeriode('ANNUELLE', 1)).toBe(1_500_000);
    expect(prixPeriode('ANNUELLE', 2)).toBe(2_000_000);
    expect(prixPeriode('MENSUELLE', 0)).toBe(150_000);
  });

  it('prolongation depuis l’échéance si elle court encore, sinon depuis aujourd’hui', () => {
    expect(prolongation(d('2026-11-15'), d('2026-11-01'), 'MENSUELLE', 2)).toEqual({
      du: d('2026-11-15'),
      au: d('2027-01-15'),
    });
    expect(prolongation(d('2026-10-01'), d('2026-11-01'), 'ANNUELLE', 1)).toEqual({
      du: d('2026-11-01'),
      au: d('2027-11-01'),
    });
    expect(prolongation(null, d('2027-01-31'), 'MENSUELLE', 1).au).toEqual(d('2027-02-28'));
  });

  it('état : essai, abonné, à renouveler, délai de grâce, expiré, sans échéance', () => {
    const creation = d('2026-10-01');
    const essai = finEssai(creation);
    expect(etatAbonnement(essai, essai, d('2026-10-10'))).toEqual({
      etat: 'ESSAI',
      joursRestants: 21,
    });
    expect(etatAbonnement(d('2026-12-31'), essai, d('2026-11-01')).etat).toBe('ACTIF');
    expect(etatAbonnement(d('2026-11-05'), null, d('2026-11-01'))).toEqual({
      etat: 'A_RENOUVELER',
      joursRestants: 4,
    });
    expect(etatAbonnement(d('2026-11-01'), null, d('2026-11-04')).etat).toBe('EN_GRACE');
    expect(etatAbonnement(d('2026-11-01'), null, d('2026-11-08')).etat).toBe('EXPIRE');
    expect(etatAbonnement(null, null, d('2030-01-01'))).toEqual({
      etat: 'ILLIMITE',
      joursRestants: null,
    });
    expect(messageAbonnementExpire(d('2026-11-01'))).toMatch(/01\/11\/2026.*conservées/);
  });

  it('avertissement du propriétaire : préavis, essai, délai de grâce', () => {
    expect(avertissementAbonnement(d('2026-12-31'), false, d('2026-11-01'))).toBeNull();
    expect(avertissementAbonnement(null, false, d('2026-11-01'))).toBeNull();
    expect(avertissementAbonnement(d('2026-11-05'), false, d('2026-11-01'))?.texte).toMatch(
      /dans 4 jours/,
    );
    expect(avertissementAbonnement(d('2026-11-02'), true, d('2026-11-01'))?.texte).toMatch(
      /essai gratuit se termine demain/,
    );
    const grace = avertissementAbonnement(d('2026-11-01'), false, d('2026-11-03'));
    expect(grace?.niveau).toBe('erreur');
    expect(grace?.texte).toMatch(/coupé le 08\/11\/2026/);
  });
});
