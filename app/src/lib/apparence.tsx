import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { lire, ecrire } from './stockage';
import { ContexteMode, type Mode, useMode } from './theme';

const CLE = 'gestvente.apparence';

const ContexteBascule = createContext<() => void>(() => undefined);

/**
 * Choix clair / sombre fait à la main (bouton ☀️/🌙), gardé sur l'appareil. Tant que rien
 * n'est choisi, l'application suit le réglage de l'appareil.
 */
export function FournisseurApparence({ children }: { children: ReactNode }) {
  const [choisi, setChoisi] = useState<Mode | null>(null);
  useEffect(() => {
    lire<Mode>(CLE)
      .then((m) => (m === 'clair' || m === 'sombre' ? setChoisi(m) : undefined))
      .catch(() => undefined);
  }, []);
  return (
    <ContexteMode.Provider value={choisi}>
      <Bascule surChoix={setChoisi}>{children}</Bascule>
    </ContexteMode.Provider>
  );
}

/** Fournit la bascule (sous le fournisseur de mode, pour connaître le mode affiché). */
function Bascule({ children, surChoix }: { children: ReactNode; surChoix: (m: Mode) => void }) {
  const mode = useMode();
  const basculer = useCallback(() => {
    const suivant: Mode = mode === 'sombre' ? 'clair' : 'sombre';
    surChoix(suivant);
    ecrire(CLE, suivant).catch(() => undefined);
  }, [mode, surChoix]);
  const valeur = useMemo(() => basculer, [basculer]);
  return <ContexteBascule.Provider value={valeur}>{children}</ContexteBascule.Provider>;
}

/** Passe du mode clair au mode sombre et inversement. */
export function useBasculerApparence() {
  return useContext(ContexteBascule);
}
