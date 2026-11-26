import type { EtatAbonnement, ParametresRappels, Role } from '@gestvente/commun';
import { API_URL } from './config';
import { MESSAGES, messageClair, messageStatut } from './erreurs';

/** Version web (site) : seul cas où le pare-feu de l'hébergeur impose son défi. */
const SITE = typeof document !== 'undefined';

export interface Jetons {
  jetonAcces: string;
  jetonRafraichissement: string;
}

export interface Session extends Jetons {
  appareilId: string;
  utilisateur: { id: string; nom: string; role: Role; commerceId: string };
}

export interface Boutique {
  id: string;
  nom: string;
  prefixe: string;
  adresse: string | null;
  /** Absent d'un profil gardé avant l'étape 9. */
  telephone?: string | null;
}

export interface Profil {
  id: string;
  nom: string;
  identifiant: string;
  role: Role;
  appareilId: string;
  pinDefini: boolean;
  /** Plus grand numéro d'ordre de facture de cet appareil sur le serveur. */
  dernierOrdreFacture?: number;
  commerce: {
    id: string;
    nom: string;
    monnaie: string;
    indicatif: string;
    fuseau?: string;
    remiseMaxVendeur: number;
    remiseMaxGerant: number;
    delaiRetourJours?: number;
    /** Absent des profils gardés avant le troc : REPRISE_MAX_VENDEUR_DEFAUT. */
    repriseMaxVendeur?: number;
    /** Rappels des tranches et pénalité (absent des profils gardés avant l'étape 17). */
    rappels?: ParametresRappels;
    /** Échéance de l'abonnement (absent des profils gardés avant l'étape 23). */
    abonnement?: { etat: EtatAbonnement; joursRestants: number | null; jusquAu: string | null };
  };
  boutiques: Boutique[];
}

/** Réponse d'erreur de l'API (message en français prêt à afficher). */
export class ErreurApi extends Error {
  constructor(
    readonly statut: number,
    message: string,
    /** Code précis renvoyé par l'API (ex. APPAREIL_NON_AUTORISE). */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Le serveur n'a pas pu être joint (hors ligne, réseau lent). */
export class ErreurReseau extends Error {
  constructor() {
    super(MESSAGES.reseau);
  }
}

export interface Options {
  methode?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON, ou FormData pour envoyer un fichier (photo, classeur Excel). */
  corps?: unknown;
  /** Réponse brute (fichier à télécharger) au lieu de JSON. */
  fichier?: boolean;
}

interface Branchements {
  lireJetons: () => Jetons | null;
  enregistrerJetons: (jetons: Jetons) => Promise<void>;
  /** Le serveur a fermé la session (déconnexion à distance, jeton volé, expiration). */
  sessionPerdue: () => void;
}

export async function appeler<T>(chemin: string, options: Options, jeton?: string): Promise<T> {
  let reponse: Response;
  const formulaire = options.corps instanceof FormData;
  const envoyer = () =>
    fetch(`${API_URL}${chemin}`, {
      method: options.methode ?? 'GET',
      // Site : cookies de l'hébergeur (défi anti-robots d'o2switch) envoyés à l'API.
      ...(SITE ? { credentials: 'include' as const } : {}),
      headers: {
        Accept: 'application/json',
        // FormData : le navigateur ou React Native pose lui-même l'en-tête multipart.
        ...(options.corps !== undefined && !formulaire
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      },
      body: formulaire
        ? (options.corps as FormData)
        : options.corps !== undefined
          ? JSON.stringify(options.corps)
          : undefined,
    });
  try {
    reponse = await envoyer();
  } catch {
    // Le pare-feu de l'hébergeur répond d'abord à un navigateur par un défi (redirection
    // et cookie), refusé par le navigateur entre deux sous-domaines ; le cookie est posé,
    // et le second envoi passe. Ce premier envoi n'a pas atteint l'API ; après une vraie coupure,
    // le second échoue aussi (les opérations de synchronisation ont un identifiant : pas de doublon).
    if (!SITE) throw new ErreurReseau();
    try {
      reponse = await envoyer();
    } catch {
      throw new ErreurReseau();
    }
  }
  if (reponse.status === 204) return undefined as T;
  if (options.fichier && reponse.ok) return (await reponse.blob()) as T;
  const donnees: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    const { message, code } =
      (donnees as { message?: string | string[]; code?: string } | null) ?? {};
    throw new ErreurApi(
      reponse.status,
      Array.isArray(message) ? message.join('\n') : (message ?? messageStatut(reponse.status)),
      typeof code === 'string' ? code : undefined,
    );
  }
  return donnees as T;
}

/**
 * Client de l'API : ajoute le jeton d'accès, le renouvelle une seule fois
 * (même si plusieurs requêtes échouent en même temps) quand il a expiré.
 */
export function creerClientApi(b: Branchements) {
  let renouvellement: Promise<boolean> | null = null;

  const renouveler = () => {
    renouvellement ??= (async () => {
      const jetons = b.lireJetons();
      if (!jetons) return false;
      try {
        const session = await appeler<Session>('/auth/rafraichir', {
          methode: 'POST',
          corps: { jetonRafraichissement: jetons.jetonRafraichissement },
        });
        await b.enregistrerJetons(session);
        return true;
      } catch (erreur) {
        if (erreur instanceof ErreurApi && erreur.statut === 401) b.sessionPerdue();
        if (erreur instanceof ErreurReseau) throw erreur;
        return false;
      } finally {
        renouvellement = null;
      }
    })();
    return renouvellement;
  };

  return {
    /** Requête sans jeton (connexion). */
    publique: <T>(chemin: string, options: Options = {}) => appeler<T>(chemin, options),

    async requete<T>(chemin: string, options: Options = {}): Promise<T> {
      try {
        return await appeler<T>(chemin, options, b.lireJetons()?.jetonAcces);
      } catch (erreur) {
        if (!(erreur instanceof ErreurApi) || erreur.statut !== 401) throw erreur;
        if (!(await renouveler())) throw erreur;
        return appeler<T>(chemin, options, b.lireJetons()?.jetonAcces);
      }
    },
  };
}

export type ClientApi = ReturnType<typeof creerClientApi>;

/** Message lisible pour l'utilisateur, quelle que soit l'erreur. */
export function messageErreur(erreur: unknown): string {
  return messageClair(erreur);
}
