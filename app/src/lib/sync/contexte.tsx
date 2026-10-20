import { peutGererSessions, type TypeOperation } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  type DependencyList,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { type BaseOuverte, effacerBase, ouvrirBase } from '../base/ouvrir';
import type { BaseSql } from '../base/sql';
import { useSession } from '../session';
import { type EtatSync, MoteurSync } from './moteur';
import { enregistrerOperation, type NouvelleOperation } from './operations-locales';

/** Synchronisation automatique toutes les 30 secondes quand l'application est utilisée. */
const INTERVALLE_MS = 30_000;

const ETAT_INITIAL: EtatSync = {
  reseau: 'inconnu',
  enCours: false,
  enAttente: 0,
  refusees: 0,
  enConflit: 0,
  derniereSync: null,
  erreur: null,
};

interface ValeurSync {
  base: BaseSql | null;
  etat: EtatSync;
  /** Conflits à traiter sur le serveur (gérant, propriétaire). */
  conflits: number;
  /** Change à chaque modification des données locales : relire les écrans. */
  version: number;
  synchroniser: () => void;
  enregistrer: <T extends TypeOperation>(operation: NouvelleOperation<T>) => Promise<void>;
  effacerRefusees: () => Promise<void>;
}

const Contexte = createContext<ValeurSync | null>(null);

export function FournisseurSync({ children }: { children: ReactNode }) {
  const { statut, profil, api } = useSession();
  const [ouverte, setOuverte] = useState<BaseOuverte | null>(null);
  const [moteur, setMoteur] = useState<MoteurSync | null>(null);
  const [etat, setEtat] = useState<EtatSync>(ETAT_INITIAL);
  const [conflits, setConflits] = useState(0);
  const [version, setVersion] = useState(0);
  const connecte = statut !== 'chargement' && statut !== 'deconnecte' && !!profil;
  const gestion = !!profil && peutGererSessions(profil.role);

  // Base ouverte tant qu'une session existe (même verrouillée) ; effacée à la déconnexion.
  useEffect(() => {
    if (!connecte) return;
    let actif = true;
    let base: BaseOuverte | null = null;
    ouvrirBase()
      .then((b) => {
        base = b;
        if (!actif) return;
        const m = new MoteurSync(b.base, api);
        setOuverte(b);
        setMoteur(m);
      })
      .catch((e: unknown) => setEtat((s) => ({ ...s, erreur: (e as Error).message })));
    return () => {
      actif = false;
      void base?.fermer().catch(() => undefined);
      setOuverte(null);
      setMoteur(null);
    };
  }, [connecte, api]);

  useEffect(() => {
    if (statut === 'deconnecte') void effacerBase(null);
  }, [statut]);

  useEffect(() => {
    if (!moteur) return;
    let derniere: string | null = null;
    return moteur.abonner((nouvel) => {
      setEtat(nouvel);
      if (nouvel.derniereSync !== derniere) {
        derniere = nouvel.derniereSync;
        setVersion((v) => v + 1);
      }
    });
  }, [moteur]);

  const synchroniser = useCallback(() => {
    if (!moteur) return;
    void moteur.synchroniser().then(async () => {
      if (!gestion) return;
      try {
        setConflits((await api.requete<unknown[]>('/sync/conflits')).length);
      } catch {
        // Hors ligne : le compteur sera mis à jour au prochain passage.
      }
    });
  }, [moteur, api, gestion]);

  // Synchronisation au démarrage, à intervalle régulier et au retour au premier plan.
  useEffect(() => {
    if (!moteur || statut !== 'pret') return;
    synchroniser();
    const minuterie = setInterval(synchroniser, INTERVALLE_MS);
    const abonnement = AppState.addEventListener('change', (e) => {
      if (e === 'active') synchroniser();
    });
    return () => {
      clearInterval(minuterie);
      abonnement.remove();
    };
  }, [moteur, statut, synchroniser]);

  const valeur = useMemo<ValeurSync>(
    () => ({
      base: ouverte?.base ?? null,
      etat,
      conflits,
      version,
      synchroniser,
      async enregistrer(operation) {
        if (!ouverte || !moteur) throw new Error('Base locale pas encore prête.');
        await enregistrerOperation(ouverte.base, { ...operation, utilisateurId: profil?.id }, () =>
          Crypto.randomUUID(),
        );
        setVersion((v) => v + 1);
        await moteur.actualiserCompteurs();
        synchroniser();
      },
      async effacerRefusees() {
        await moteur?.effacerRefusees();
      },
    }),
    [ouverte, moteur, etat, conflits, version, synchroniser, profil?.id],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSync(): ValeurSync {
  const valeur = useContext(Contexte);
  if (!valeur) throw new Error('useSync hors de FournisseurSync');
  return valeur;
}

/** Lecture de la base locale, relue quand les données changent. */
export function useLecture<T>(
  lire: (base: BaseSql) => Promise<T>,
  dependances: DependencyList,
): T | undefined {
  const { base, version } = useSync();
  const [resultat, setResultat] = useState<T>();
  useEffect(() => {
    if (!base) return;
    let actif = true;
    lire(base)
      .then((r) => actif && setResultat(r))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, version, ...dependances]);
  return resultat;
}
