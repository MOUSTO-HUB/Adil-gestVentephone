import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { EtatAbonnement, FormuleAbonnement } from '@gestvente/commun';
import { appeler, ErreurApi, type Options } from './api';
import { effacer, ecrire, lire } from './stockage';

/**
 * Session du concepteur de la plateforme : distincte de celle des commerçants
 * (pas de code PIN, pas de base locale ; tout se fait en ligne).
 */
const CLE = 'gestvente.concepteur';

interface SessionConcepteur {
  jeton: string;
  nom: string;
  /** Mot de passe provisoire : à changer avant tout (écran Mon compte). */
  doitChangerMotDePasse?: boolean;
  /** Double authentification par application active sur ce compte. */
  doubleAuth?: boolean;
}

/** Réponse de connexion : session, ou code de l'application d'authentification demandé. */
type ReponseConnexion =
  | { doubleAuth: true }
  | {
      jeton: string;
      concepteur: { nom: string; doitChangerMotDePasse?: boolean; doubleAuth?: boolean };
    };

interface ValeurPlateforme {
  chargement: boolean;
  session: SessionConcepteur | null;
  /** « code » : le mot de passe est bon, il faut le code à 6 chiffres de l'application. */
  connexion: (
    identifiant: string,
    motDePasse: string,
    code?: string,
  ) => Promise<'connecte' | 'code'>;
  /** Met à jour la session (mot de passe changé, double authentification activée…). */
  majSession: (changement: Partial<Omit<SessionConcepteur, 'jeton'>>) => Promise<void>;
  deconnexion: () => Promise<void>;
  requete: <T>(chemin: string, options?: Options) => Promise<T>;
  /** Demandes « Mot de passe oublié » en attente (pastille, relue chaque minute). */
  demandesEnAttente: number;
  rafraichirDemandes: () => void;
}

/** Fréquence de relecture des demandes en attente dans l'espace concepteur. */
const RELECTURE_DEMANDES_MS = 60_000;

const Contexte = createContext<ValeurPlateforme | null>(null);

export function FournisseurPlateforme({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionConcepteur | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    lire<SessionConcepteur>(CLE)
      .then((s) => setSession(s))
      .finally(() => setChargement(false));
  }, []);

  const deconnexion = useCallback(async () => {
    setSession(null);
    await effacer(CLE);
  }, []);

  const [demandesEnAttente, setDemandesEnAttente] = useState(0);
  const jeton = session?.jeton;
  const rafraichirDemandes = useCallback(() => {
    if (!jeton) return;
    appeler<{ enAttente: number }>('/plateforme/demandes/compte', {}, jeton).then(
      (r) => setDemandesEnAttente(r.enAttente),
      () => undefined,
    );
  }, [jeton]);
  useEffect(() => {
    if (!jeton) return;
    rafraichirDemandes();
    const minuterie = setInterval(rafraichirDemandes, RELECTURE_DEMANDES_MS);
    return () => clearInterval(minuterie);
  }, [jeton, rafraichirDemandes]);

  const valeur = useMemo<ValeurPlateforme>(
    () => ({
      chargement,
      session,
      async connexion(identifiant, motDePasse, code) {
        const r = await appeler<ReponseConnexion>('/plateforme/connexion', {
          methode: 'POST',
          corps: { identifiant, motDePasse, ...(code ? { code } : {}) },
        });
        if ('doubleAuth' in r) return 'code';
        const nouvelle: SessionConcepteur = {
          jeton: r.jeton,
          nom: r.concepteur.nom,
          doitChangerMotDePasse: !!r.concepteur.doitChangerMotDePasse,
          doubleAuth: !!r.concepteur.doubleAuth,
        };
        await ecrire(CLE, nouvelle);
        setSession(nouvelle);
        return 'connecte';
      },
      async majSession(changement) {
        if (!session) return;
        const nouvelle = { ...session, ...changement };
        await ecrire(CLE, nouvelle);
        setSession(nouvelle);
      },
      deconnexion,
      async requete<T>(chemin: string, options: Options = {}) {
        try {
          return await appeler<T>(`/plateforme${chemin}`, options, session?.jeton);
        } catch (e) {
          // Session expirée (10 heures) ou compte désactivé : retour à la connexion.
          if (e instanceof ErreurApi && e.statut === 401) await deconnexion();
          throw e;
        }
      },
      // Hors session : aucune demande affichée (le compteur garde la dernière valeur lue).
      demandesEnAttente: session ? demandesEnAttente : 0,
      rafraichirDemandes,
    }),
    [chargement, session, deconnexion, demandesEnAttente, rafraichirDemandes],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function usePlateforme(): ValeurPlateforme {
  const valeur = useContext(Contexte);
  if (!valeur) throw new Error('usePlateforme hors de FournisseurPlateforme');
  return valeur;
}

/** « 31/12/2026 » → date ISO (fin de journée), ou null si la saisie est invalide. */
export function dateSaisie(texte: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texte.trim());
  if (!m) return null;
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
  return Number.isNaN(date.getTime()) || date.getDate() !== Number(m[1])
    ? null
    : date.toISOString();
}

export type StatutCommerce = 'ACTIF' | 'SUSPENDU' | 'SUPPRIME';

/** Ligne de la liste des commerçants abonnés. */
export interface ResumeCommerce {
  id: string;
  nom: string;
  telephone: string;
  statut: StatutCommerce;
  motifStatut: string | null;
  abonnementJusquAu: string | null;
  abonnement: EtatAbonnementCommerce;
  creeLe: string;
  proprietaire: { nom: string; identifiant: string; derniereConnexion: string | null } | null;
  boutiques: number;
  boutiquesVerrouillees: number;
  utilisateurs: number;
  produits: number;
  ventes30Jours: number;
  derniereVente: string | null;
}

/** Fiche d'un commerçant. */
export interface DetailCommerce {
  id: string;
  nom: string;
  telephone: string;
  adresse: string | null;
  statut: StatutCommerce;
  motifStatut: string | null;
  abonnementJusquAu: string | null;
  essaiJusquAu: string | null;
  abonnement: EtatAbonnementCommerce;
  /** Prix d'une période selon les boutiques ouvertes (GNF). */
  tarifs: Record<FormuleAbonnement, number>;
  paiements: PaiementAbonnement[];
  creeLe: string;
  produits: number;
  clients: number;
  boutiques: {
    id: string;
    nom: string;
    prefixe: string;
    adresse: string | null;
    telephone: string | null;
    verrouillee: boolean;
    supprimeeLe: string | null;
  }[];
  utilisateurs: {
    id: string;
    nom: string;
    identifiant: string;
    role: string;
    actif: boolean;
    derniereConnexion: string | null;
  }[];
}

export interface EtatAbonnementCommerce {
  etat: EtatAbonnement;
  joursRestants: number | null;
}

export type MoyenAbonnement = 'ESPECES' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'VIREMENT';

export interface PaiementAbonnement {
  id: string;
  formule: FormuleAbonnement;
  periodes: number;
  montant: number;
  moyen: MoyenAbonnement;
  reference: string | null;
  periodeDu: string;
  periodeAu: string;
  saisiPar: string;
  creeLe: string;
}

/** Tableau de bord du concepteur (montants en GNF). */
export interface TableauPlateforme {
  commerces: { total: number; actifs: number; suspendus: number; nouveauxCeMois: number };
  abonnements: Record<EtatAbonnement, number>;
  encaisse: Record<'mois' | 'annee', { montant: number; paiements: number }>;
  echeances: {
    id: string;
    nom: string;
    etat: EtatAbonnement;
    jusquAu: string;
    joursRestants: number;
  }[];
  derniersPaiements: {
    id: string;
    commerceId: string;
    commerce: string;
    formule: FormuleAbonnement;
    periodes: number;
    montant: number;
    moyen: MoyenAbonnement;
    creeLe: string;
  }[];
}

/** Mot de passe provisoire affiché une seule fois. */
export interface AccesProvisoire {
  identifiant: string;
  motDePasse: string;
}
