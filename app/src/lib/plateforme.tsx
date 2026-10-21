import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
}

interface ValeurPlateforme {
  chargement: boolean;
  session: SessionConcepteur | null;
  connexion: (identifiant: string, motDePasse: string) => Promise<void>;
  deconnexion: () => Promise<void>;
  requete: <T>(chemin: string, options?: Options) => Promise<T>;
}

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

  const valeur = useMemo<ValeurPlateforme>(
    () => ({
      chargement,
      session,
      async connexion(identifiant, motDePasse) {
        const r = await appeler<{ jeton: string; concepteur: { nom: string } }>(
          '/plateforme/connexion',
          { methode: 'POST', corps: { identifiant, motDePasse } },
        );
        const nouvelle = { jeton: r.jeton, nom: r.concepteur.nom };
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
    }),
    [chargement, session, deconnexion],
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

/** Mot de passe provisoire affiché une seule fois. */
export interface AccesProvisoire {
  identifiant: string;
  motDePasse: string;
}
