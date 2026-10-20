import { apresEssaiPin, erreurNouveauPin, ETAT_PIN_INITIAL, type EtatPin } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import {
  type Boutique,
  type ClientApi,
  creerClientApi,
  ErreurReseau,
  type Jetons,
  type Profil,
  type Session,
} from './api';
import { creerPinLocal, pinCorrect, type PinLocal } from './pin-local';
import { CLES, effacer, ecrire, lire } from './stockage';

/**
 * - chargement : lecture du coffre de l'appareil ;
 * - deconnecte : connexion par identifiant et mot de passe ;
 * - pin-a-definir : session ouverte, code PIN à créer (ou à confirmer sur un nouvel appareil) ;
 * - verrouille : application verrouillée, code PIN demandé (vérifié hors ligne) ;
 * - pret : utilisable.
 */
export type Statut = 'chargement' | 'deconnecte' | 'pin-a-definir' | 'verrouille' | 'pret';

/** Verrouillage après ce temps passé en arrière-plan. */
const VERROUILLAGE_APRES_MS = 2 * 60 * 1000;

interface ValeurSession {
  statut: Statut;
  profil: Profil | null;
  boutique: Boutique | null;
  etatPin: EtatPin;
  api: ClientApi;
  connexion: (identifiant: string, motDePasse: string) => Promise<void>;
  /** Crée le code PIN du compte (premier appareil). */
  creerPin: (pin: string) => Promise<void>;
  /** Confirme le code PIN existant du compte sur un nouvel appareil. */
  confirmerPin: (pin: string) => Promise<boolean>;
  /** Déverrouille hors ligne ; trop d'erreurs ramènent à la connexion. */
  deverrouiller: (pin: string) => Promise<boolean>;
  verrouiller: () => void;
  /** null : revenir au choix de la boutique. */
  choisirBoutique: (boutique: Boutique | null) => Promise<void>;
  /** Relit le profil sur le serveur ; faux si le serveur est injoignable (profil en cache gardé). */
  rafraichirProfil: () => Promise<boolean>;
  deconnexion: () => Promise<void>;
}

/**
 * Jetons et empreinte du PIN : lus hors du rendu (requêtes, déverrouillage), sans
 * provoquer de rendu. Une seule session par application.
 */
const memoire: { jetons: Jetons | null; pin: PinLocal | null } = { jetons: null, pin: null };

function memoriserJetons(jetons: Jetons | null): Jetons | null {
  memoire.jetons = jetons
    ? { jetonAcces: jetons.jetonAcces, jetonRafraichissement: jetons.jetonRafraichissement }
    : null;
  return memoire.jetons;
}

function memoriserPin(pin: PinLocal | null): PinLocal | null {
  memoire.pin = pin;
  return pin;
}

const Contexte = createContext<ValeurSession | null>(null);

function plateforme(): string {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web')
    return Platform.OS;
  if (Platform.OS === 'windows') return 'windows';
  if (Platform.OS === 'macos') return 'macos';
  return 'autre';
}

function nomAppareil(): string {
  const nom =
    Device.deviceName ?? [Device.manufacturer, Device.modelName].filter(Boolean).join(' ');
  return (nom || (Platform.OS === 'web' ? 'Navigateur' : 'Appareil')).slice(0, 80);
}

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [statut, setStatut] = useState<Statut>('chargement');
  const [profil, setProfil] = useState<Profil | null>(null);
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [etatPin, setEtatPin] = useState<EtatPin>(ETAT_PIN_INITIAL);

  /** Efface tout ce que l'appareil garde de la session. */
  const oublier = useCallback(async () => {
    memoriserJetons(null);
    memoriserPin(null);
    setProfil(null);
    setBoutique(null);
    setEtatPin(ETAT_PIN_INITIAL);
    await effacer(CLES.jetons, CLES.profil, CLES.pin, CLES.etatPin, CLES.boutique);
    setStatut('deconnecte');
  }, []);

  const api = useMemo(
    () =>
      creerClientApi({
        lireJetons: () => memoire.jetons,
        enregistrerJetons: async (nouveaux) => {
          await ecrire(CLES.jetons, memoriserJetons(nouveaux));
        },
        sessionPerdue: () => void oublier(),
      }),
    [oublier],
  );

  const appliquerProfil = useCallback(async (nouveau: Profil) => {
    setProfil(nouveau);
    await ecrire(CLES.profil, nouveau);
    // Boutique retenue si elle est encore accessible ; une seule boutique : choisie d'office.
    const retenue = await lire<Boutique>(CLES.boutique);
    const choisie =
      nouveau.boutiques.find((b) => b.id === retenue?.id) ??
      (nouveau.boutiques.length === 1 ? nouveau.boutiques[0] : null);
    setBoutique(choisie);
    if (choisie) await ecrire(CLES.boutique, choisie);
    else await effacer(CLES.boutique);
  }, []);

  const rafraichirProfil = useCallback(async () => {
    try {
      await appliquerProfil(await api.requete<Profil>('/auth/moi'));
      return true;
    } catch (erreur) {
      // Hors ligne : on garde le profil en cache.
      if (!(erreur instanceof ErreurReseau)) throw erreur;
      return false;
    }
  }, [api, appliquerProfil]);

  // Démarrage : lecture du coffre.
  useEffect(() => {
    void (async () => {
      memoriserJetons(await lire<Jetons>(CLES.jetons));
      if (!memoire.jetons) {
        setStatut('deconnecte');
        return;
      }
      memoriserPin(await lire<PinLocal>(CLES.pin));
      setEtatPin((await lire<EtatPin>(CLES.etatPin)) ?? ETAT_PIN_INITIAL);
      setProfil(await lire<Profil>(CLES.profil));
      setBoutique(await lire<Boutique>(CLES.boutique));
      setStatut(memoire.pin ? 'verrouille' : 'pin-a-definir');
    })();
  }, []);

  // Verrouillage après un passage prolongé en arrière-plan.
  useEffect(() => {
    let depart: number | null = null;
    const abonnement = AppState.addEventListener('change', (etat) => {
      if (etat === 'background') depart = Date.now();
      if (etat === 'active' && depart !== null) {
        if (Date.now() - depart > VERROUILLAGE_APRES_MS) {
          setStatut((s) => (s === 'pret' ? 'verrouille' : s));
        }
        depart = null;
      }
    });
    return () => abonnement.remove();
  }, []);

  const enregistrerPinLocal = useCallback(async (pin: string) => {
    await ecrire(CLES.pin, memoriserPin(creerPinLocal(pin, Crypto.getRandomBytes(16))));
    setEtatPin(ETAT_PIN_INITIAL);
    await ecrire(CLES.etatPin, ETAT_PIN_INITIAL);
  }, []);

  const valeur = useMemo<ValeurSession>(
    () => ({
      statut,
      profil,
      boutique,
      etatPin,
      api,
      rafraichirProfil,

      async connexion(identifiant, motDePasse) {
        const session = await api.publique<Session>('/auth/connexion', {
          methode: 'POST',
          corps: {
            identifiant,
            motDePasse,
            appareil: { nom: nomAppareil(), plateforme: plateforme() },
          },
        });
        await ecrire(CLES.jetons, memoriserJetons(session));
        await appliquerProfil(await api.requete<Profil>('/auth/moi'));
        setStatut('pin-a-definir');
      },

      async creerPin(pin) {
        const erreur = erreurNouveauPin(pin);
        if (erreur) throw new Error(erreur);
        await api.requete('/auth/pin', { methode: 'PUT', corps: { pin } });
        await enregistrerPinLocal(pin);
        setProfil((p) => (p ? { ...p, pinDefini: true } : p));
        setStatut('pret');
      },

      async confirmerPin(pin) {
        const { valide } = await api.requete<{ valide: boolean }>('/auth/pin/verification', {
          methode: 'POST',
          corps: { pin },
        });
        if (!valide) return false;
        await enregistrerPinLocal(pin);
        setStatut('pret');
        return true;
      },

      async deverrouiller(pin) {
        if (!memoire.pin) return false;
        const correct = pinCorrect(pin, memoire.pin);
        const nouvelEtat = apresEssaiPin(etatPin, correct);
        setEtatPin(nouvelEtat);
        await ecrire(CLES.etatPin, nouvelEtat);
        if (nouvelEtat.bloque) {
          await oublier();
          return false;
        }
        if (correct) {
          setStatut('pret');
          void rafraichirProfil().catch(() => undefined);
        }
        return correct;
      },

      verrouiller: () => setStatut((s) => (s === 'pret' ? 'verrouille' : s)),

      async choisirBoutique(choisie) {
        setBoutique(choisie);
        if (choisie) await ecrire(CLES.boutique, choisie);
        else await effacer(CLES.boutique);
      },

      async deconnexion() {
        // Hors ligne, la session sera fermée côté serveur à l'expiration ou à distance.
        await api.requete('/auth/deconnexion', { methode: 'POST' }).catch(() => undefined);
        await oublier();
      },
    }),
    [
      statut,
      profil,
      boutique,
      etatPin,
      api,
      rafraichirProfil,
      appliquerProfil,
      enregistrerPinLocal,
      oublier,
    ],
  );

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSession(): ValeurSession {
  const valeur = useContext(Contexte);
  if (!valeur) throw new Error('useSession hors de FournisseurSession');
  return valeur;
}
