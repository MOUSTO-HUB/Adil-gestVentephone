import { HttpException } from '@nestjs/common';
import { contexteHttp } from '../auth/guards/contexte.test-utils.js';
import { DebitGuard } from './debit.guard.js';
import { type Limite, LIMITES, type LimiteurService } from './limiteur.service.js';

/** Limiteur en mémoire : mêmes règles que celui de Redis. */
function limiteurMemoire() {
  const compteurs = new Map<string, number>();
  return {
    compteurs,
    async verifier(limite: Limite, identifiant: string) {
      const cle = `${limite.nom}:${identifiant}`;
      const compte = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, compte);
      if (compte > limite.max) throw new HttpException(limite.message, 429);
    },
  };
}

describe('DebitGuard', () => {
  const requete = (ip: string, path = '/api/sync/changements') =>
    contexteHttp({ ip, path } as never);

  it('limite les requêtes par adresse IP', async () => {
    const limiteur = limiteurMemoire();
    const garde = new DebitGuard(limiteur as unknown as LimiteurService);
    for (let i = 0; i < LIMITES.requetesIp.max; i++) {
      await expect(garde.canActivate(requete('41.223.48.10'))).resolves.toBe(true);
    }
    await expect(garde.canActivate(requete('41.223.48.10'))).rejects.toThrow(/Trop de requêtes/);
    // Une autre connexion n'est pas touchée.
    await expect(garde.canActivate(requete('41.223.48.11'))).resolves.toBe(true);
  });

  it('plus strict sur le lien public des factures ; adresses locales libres', async () => {
    const limiteur = limiteurMemoire();
    const garde = new DebitGuard(limiteur as unknown as LimiteurService);
    for (let i = 0; i < LIMITES.facturePublique.max; i++) {
      await garde.canActivate(requete('41.223.48.20', '/api/f/AbCdEf1234'));
    }
    await expect(garde.canActivate(requete('41.223.48.20', '/api/f/XyZ'))).rejects.toThrow(
      /consultations/,
    );
    await expect(garde.canActivate(requete('127.0.0.1'))).resolves.toBe(true);
    expect([...limiteur.compteurs.keys()].some((c) => c.includes('127.0.0.1'))).toBe(false);
  });
});
