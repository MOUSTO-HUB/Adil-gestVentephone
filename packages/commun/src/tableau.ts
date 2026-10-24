/**
 * Tableau de bord consolidé du propriétaire : chiffres de chaque boutique et de
 * l'ensemble, comparaison avec la période précédente, situation des trocs.
 */

export interface ChiffresBoutique {
  boutiqueId: string;
  nom: string;
  /** Chiffre d'affaires net (ventes remises déduites, moins les retours). */
  chiffreAffaires: number;
  benefice: number;
  nombreVentes: number;
  /** Valeur du stock au prix d'achat et au prix de vente. */
  stockAchat: number;
  stockVente: number;
  creditsEnCours: number;
  /** Reste dû sur les crédits en cours. */
  creditsDu: number;
  creditsEnRetard: number;
  /** Tranches échues non payées. */
  creditsEchus: number;
  depenses: number;
  /** Écart total des caisses clôturées de la période (compté − attendu). */
  ecartsCaisse: number;
  caissesOuvertes: number;
  caissesAValider: number;
  /** Dernière opération reçue d'un appareil de la boutique. */
  derniereSync: string | null;
}

const CHAMPS_SOMMES = [
  'chiffreAffaires',
  'benefice',
  'nombreVentes',
  'stockAchat',
  'stockVente',
  'creditsEnCours',
  'creditsDu',
  'creditsEnRetard',
  'creditsEchus',
  'depenses',
  'ecartsCaisse',
  'caissesOuvertes',
  'caissesAValider',
] as const;

/** Total de toutes les boutiques ; dernière synchronisation : la plus ancienne (à surveiller). */
export function totaliser(
  boutiques: ChiffresBoutique[],
): Omit<ChiffresBoutique, 'boutiqueId' | 'nom'> {
  const total = Object.fromEntries(CHAMPS_SOMMES.map((c) => [c, 0])) as Record<
    (typeof CHAMPS_SOMMES)[number],
    number
  >;
  for (const b of boutiques) for (const c of CHAMPS_SOMMES) total[c] += b[c];
  const syncs = boutiques.map((b) => b.derniereSync);
  return {
    ...total,
    derniereSync: syncs.includes(null) ? null : (syncs.sort()[0] ?? null),
  };
}

/** Période de même durée juste avant [du, au[. */
export function periodePrecedente(du: Date, au: Date): { du: Date; au: Date } {
  const duree = au.getTime() - du.getTime();
  return { du: new Date(du.getTime() - duree), au: new Date(du.getTime()) };
}

/** Évolution en % (arrondie à l'unité), null sans base de comparaison. */
export function evolution(actuel: number, precedent: number): number | null {
  if (precedent === 0) return actuel === 0 ? 0 : null;
  return Math.round(((actuel - precedent) / Math.abs(precedent)) * 100);
}

/** Troc tel que le lit la situation : valeur de reprise, devenir de l'appareil. */
export interface TrocSituation {
  valeurRetenue: number;
  statutArticle: 'EN_STOCK' | 'A_REPARER' | 'VENDU' | 'EN_TRANSFERT' | 'REBUT' | null;
  /** Remis en vente après réparation (passé par A_REPARER). */
  repare: boolean;
  /** Prix de la revente, si l'appareil a été revendu. */
  prixRevente: number | null;
}

/**
 * Situation des trocs : repris, à réparer, réparés, en vente, revendus, et marge sur
 * les revendus (prix de revente − valeur de reprise).
 */
export function situationTrocs(trocs: TrocSituation[]) {
  const revendus = trocs.filter((t) => t.statutArticle === 'VENDU' && t.prixRevente !== null);
  const valeurRevendus = revendus.reduce((s, t) => s + t.valeurRetenue, 0);
  const ventesRevendus = revendus.reduce((s, t) => s + (t.prixRevente ?? 0), 0);
  return {
    repris: trocs.length,
    valeurReprise: trocs.reduce((s, t) => s + t.valeurRetenue, 0),
    aReparer: trocs.filter((t) => t.statutArticle === 'A_REPARER').length,
    repares: trocs.filter((t) => t.repare).length,
    enVente: trocs.filter((t) => t.statutArticle === 'EN_STOCK').length,
    revendus: revendus.length,
    rebut: trocs.filter((t) => t.statutArticle === 'REBUT').length,
    ventesRevendus,
    marge: ventesRevendus - valeurRevendus,
  };
}
export type SituationTrocs = ReturnType<typeof situationTrocs>;
