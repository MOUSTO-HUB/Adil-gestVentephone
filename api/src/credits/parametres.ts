import type { ParametresRappels } from '@gestvente/commun';
import type { Commerce } from '../generated/prisma/client.js';

/** Réglages des rappels et de la pénalité d'un commerce. */
export const parametresDe = (c: Commerce): ParametresRappels => ({
  joursAvant: c.rappelJoursAvant,
  relancesMax: c.relancesMax,
  canal: c.canalRappels,
  penaliteActive: c.penaliteActive,
  penaliteType: c.penaliteType,
  penaliteValeur: c.penaliteValeur,
  penaliteGrace: c.penaliteGrace,
});
