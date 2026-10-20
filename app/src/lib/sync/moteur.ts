import type {
  Instantane,
  Operation,
  PageChangements,
  ResultatOperation,
  StatutOperation,
} from '@gestvente/commun';
import { ErreurApi, ErreurReseau } from '../api';
import { appliquerChangements, ecrireMeta, lireMeta, remplacerTout } from '../base/depot';
import type { BaseSql } from '../base/sql';

export const TAILLE_LOT = 50;
/** Tours envoi + réception au plus par synchronisation (des opérations arrivent pendant l'envoi). */
const TOURS_MAX = 5;
const CLE_CURSEUR = 'curseur';

/** Ce dont le moteur a besoin pour parler au serveur (le client API de l'application). */
export interface ServeurSync {
  requete<T>(chemin: string, options?: { methode?: 'GET' | 'POST'; corps?: unknown }): Promise<T>;
}

export type EtatReseau = 'inconnu' | 'en-ligne' | 'hors-ligne';

export interface EtatSync {
  reseau: EtatReseau;
  enCours: boolean;
  /** Opérations pas encore acceptées par le serveur. */
  enAttente: number;
  /** Opérations refusées par le serveur (droits, données), à montrer à l'utilisateur. */
  refusees: number;
  /** Opérations de cet appareil en conflit (aussi listées au gérant sur le serveur). */
  enConflit: number;
  derniereSync: string | null;
  erreur: string | null;
}

interface LigneOperation {
  id: string;
  type: Operation['type'];
  boutiqueId: string;
  faiteLe: string;
  contenu: string;
}

/**
 * Synchronisation : envoie la file sortante par lots, puis récupère les
 * changements du serveur depuis le curseur. La descente n'est appliquée que
 * quand la file est vide : la base locale n'écrase jamais une opération pas
 * encore acceptée.
 */
export class MoteurSync {
  private etat: EtatSync = {
    reseau: 'inconnu',
    enCours: false,
    enAttente: 0,
    refusees: 0,
    enConflit: 0,
    derniereSync: null,
    erreur: null,
  };
  private abonnes = new Set<(etat: EtatSync) => void>();
  private encore = false;

  constructor(
    private readonly base: BaseSql,
    private readonly serveur: ServeurSync,
  ) {}

  lireEtat(): EtatSync {
    return this.etat;
  }

  abonner(rappel: (etat: EtatSync) => void): () => void {
    this.abonnes.add(rappel);
    rappel(this.etat);
    return () => this.abonnes.delete(rappel);
  }

  private publier(changement: Partial<EtatSync>) {
    this.etat = { ...this.etat, ...changement };
    for (const rappel of this.abonnes) rappel(this.etat);
  }

  /** Recompte la file (après une opération enregistrée ou effacée). */
  async actualiserCompteurs(): Promise<void> {
    const lignes = await this.base.tous<{ statut: StatutOperation | 'EN_ATTENTE'; nombre: number }>(
      'SELECT statut, COUNT(*) AS nombre FROM operation GROUP BY statut',
    );
    const nombre = (filtre: (s: string) => boolean) =>
      lignes.filter((l) => filtre(l.statut)).reduce((t, l) => t + l.nombre, 0);
    this.publier({
      enAttente: nombre((s) => s === 'EN_ATTENTE'),
      refusees: nombre((s) => s === 'REJETEE'),
      enConflit: nombre((s) => s === 'CONFLIT'),
    });
  }

  /** Une synchronisation à la fois ; une demande pendant l'envoi relance un tour ensuite. */
  async synchroniser(): Promise<void> {
    if (this.etat.enCours) {
      this.encore = true;
      return;
    }
    this.publier({ enCours: true, erreur: null });
    try {
      let tours = 0;
      do {
        this.encore = false;
        await this.envoyer();
        await this.recevoir();
      } while (this.encore && ++tours < TOURS_MAX);
      this.publier({ reseau: 'en-ligne', derniereSync: new Date().toISOString() });
    } catch (erreur) {
      if (erreur instanceof ErreurReseau) this.publier({ reseau: 'hors-ligne' });
      else this.publier({ reseau: 'en-ligne', erreur: (erreur as Error).message });
    } finally {
      this.publier({ enCours: false });
      await this.actualiserCompteurs();
    }
  }

  /** Montée : la file sortante, par lots, dans l'ordre. */
  private async envoyer(): Promise<void> {
    let taille = TAILLE_LOT;
    for (;;) {
      const lignes = await this.base.tous<LigneOperation>(
        "SELECT id, type, boutiqueId, faiteLe, contenu FROM operation WHERE statut = 'EN_ATTENTE' ORDER BY ordre LIMIT ?",
        [taille],
      );
      if (lignes.length === 0) return;
      const operations: Operation[] = lignes.map((l) => ({ ...l, contenu: JSON.parse(l.contenu) }));
      let resultats: ResultatOperation[];
      try {
        ({ resultats } = await this.serveur.requete<{ resultats: ResultatOperation[] }>(
          '/sync/operations',
          { methode: 'POST', corps: { operations } },
        ));
      } catch (erreur) {
        // Lot refusé en bloc (opération mal formée) : on isole la fautive, une par une.
        if (!(erreur instanceof ErreurApi) || erreur.statut !== 400) throw erreur;
        if (taille > 1) {
          taille = 1;
          continue;
        }
        resultats = [{ id: operations[0].id, statut: 'REJETEE', motif: erreur.message }];
      }
      const recus = new Set(resultats.map((r) => r.id));
      if (!operations.every((o) => recus.has(o.id))) {
        throw new Error('Réponse du serveur incomplète : synchronisation interrompue.');
      }
      await this.base.transaction(async (tx) => {
        for (const r of resultats) {
          if (r.statut === 'APPLIQUEE') {
            await tx.executer('DELETE FROM operation WHERE id = ?', [r.id]);
          } else {
            await tx.executer('UPDATE operation SET statut = ?, motif = ? WHERE id = ?', [
              r.statut,
              r.motif ?? null,
              r.id,
            ]);
            // L'état du serveur remplace la modification locale refusée.
            await appliquerChangements(tx, r.corrections ?? []);
          }
        }
      });
    }
  }

  /** Descente : instantané au premier passage, puis changements depuis le curseur. */
  private async recevoir(): Promise<void> {
    const curseur = await lireMeta(this.base, CLE_CURSEUR);
    if (curseur === null) {
      const instantane = await this.serveur.requete<Instantane>('/sync/instantane');
      await this.siFileVide(async (tx) => {
        await remplacerTout(tx, instantane);
        await ecrireMeta(tx, CLE_CURSEUR, String(instantane.curseur));
      });
      return;
    }
    let position = Number(curseur);
    for (;;) {
      const page = await this.serveur.requete<PageChangements>(
        `/sync/changements?curseur=${position}`,
      );
      const appliquee = await this.siFileVide(async (tx) => {
        await appliquerChangements(tx, page.changements);
        await ecrireMeta(tx, CLE_CURSEUR, String(page.curseur));
      });
      if (!appliquee || !page.plus) return;
      position = page.curseur;
    }
  }

  /**
   * N'applique la descente que si aucune opération n'attend : sinon on la refera
   * au tour suivant, après l'envoi (pas de perte de la modification locale).
   */
  private async siFileVide(travail: (tx: BaseSql) => Promise<void>): Promise<boolean> {
    let appliquee = false;
    await this.base.transaction(async (tx) => {
      const attente = await tx.premier<{ nombre: number }>(
        "SELECT COUNT(*) AS nombre FROM operation WHERE statut = 'EN_ATTENTE'",
      );
      if ((attente?.nombre ?? 0) > 0) {
        this.encore = true;
        return;
      }
      await travail(tx);
      appliquee = true;
    });
    return appliquee;
  }

  /** Oublie les opérations refusées (l'utilisateur en a pris connaissance). */
  async effacerRefusees(): Promise<void> {
    await this.base.executer("DELETE FROM operation WHERE statut IN ('REJETEE', 'CONFLIT')");
    await this.actualiserCompteurs();
  }
}
