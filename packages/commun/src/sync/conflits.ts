import type { StatutArticle } from './entites.js';

/**
 * Règles de conflit appliquées par le serveur, qui fait foi : la première
 * opération synchronisée l'emporte, la suivante est signalée au gérant.
 */
export type Controle = { ok: true } | { ok: false; statut: 'REJETEE' | 'CONFLIT'; motif: string };

const OK: Controle = { ok: true };

const MOTIFS_INDISPONIBLE: Partial<Record<StatutArticle, string>> = {
  VENDU: 'Ce téléphone a déjà été vendu.',
  REBUT: 'Ce téléphone a déjà été sorti du stock.',
  EN_TRANSFERT: 'Ce téléphone est en cours de transfert.',
};

/**
 * Un téléphone (IMEI) peut-il quitter le stock de cette boutique (vente, sortie, transfert) ?
 * - inconnu : rejet (donnée invalide) ;
 * - déjà vendu, sorti ou en transfert, ou dans une autre boutique : conflit.
 */
export function controlerSortieArticle(
  article: { statut: StatutArticle; boutiqueId: string } | null,
  boutiqueId: string,
): Controle {
  if (!article) return { ok: false, statut: 'REJETEE', motif: 'Téléphone inconnu.' };
  const indisponible = MOTIFS_INDISPONIBLE[article.statut];
  if (indisponible) return { ok: false, statut: 'CONFLIT', motif: indisponible };
  if (article.boutiqueId !== boutiqueId) {
    return { ok: false, statut: 'CONFLIT', motif: 'Ce téléphone est dans une autre boutique.' };
  }
  return OK;
}

/** Un ajustement ne peut pas rendre le stock négatif (une autre opération l'a déjà fait baisser). */
export function controlerAjustementStock(quantiteActuelle: number, delta: number): Controle {
  if (quantiteActuelle + delta < 0) {
    return {
      ok: false,
      statut: 'CONFLIT',
      motif: `Stock insuffisant : ${quantiteActuelle} en stock, ajustement de ${delta}.`,
    };
  }
  return OK;
}
