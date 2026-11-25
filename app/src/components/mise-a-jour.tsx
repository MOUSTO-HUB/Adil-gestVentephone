import Ionicons from '@expo/vector-icons/Ionicons';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCouleurs } from '@/lib/theme';
import {
  miseAJourDisponible,
  REPORT_MS,
  VERIFICATION_MS,
  VERSION_SITE,
  versionPubliee,
} from '@/lib/version';

const WEB = Platform.OS === 'web';
/** Application native publiée avec les mises à jour Expo (EAS Update). */
const NATIVE_AVEC_MISES_A_JOUR = !WEB && !__DEV__ && Updates.isEnabled;

/** Dernière version publiée du site (fichier `version.json`, jamais pris dans un cache). */
async function lireVersionPubliee(): Promise<string | null> {
  const reponse = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!reponse.ok) return null;
  return versionPubliee(await reponse.json());
}

/** Vérifie s'il existe une nouvelle version ; sur téléphone, la télécharge déjà. */
async function verifier(): Promise<boolean> {
  if (WEB) return miseAJourDisponible(VERSION_SITE, await lireVersionPubliee());
  if (!NATIVE_AVEC_MISES_A_JOUR) return false;
  const resultat = await Updates.checkForUpdateAsync();
  if (!resultat.isAvailable) return false;
  await Updates.fetchUpdateAsync();
  return true;
}

/**
 * Installe la nouvelle version : sur le site (navigateur ou application installée), le
 * service worker est mis à jour puis la page rechargée ; sur téléphone, l'application
 * redémarre sur la mise à jour téléchargée. Les données de l'appareil (ventes non encore
 * envoyées comprises) restent dans sa base locale.
 */
async function installer() {
  if (WEB) {
    try {
      const enregistrement = await navigator.serviceWorker?.getRegistration();
      await enregistrement?.update();
    } catch {
      // Sans service worker (ou hors ligne), le simple rechargement suffit.
    }
    window.location.reload();
    return;
  }
  await Updates.reloadAsync();
}

/** Bandeau « Nouvelle version disponible » affiché en haut de tous les écrans. */
export function BandeauMiseAJour() {
  const c = useCouleurs();
  const marges = useSafeAreaInsets();
  const [disponible, setDisponible] = useState(false);
  const [reporte, setReporte] = useState(false);
  const [installation, setInstallation] = useState(false);
  const actif = WEB ? !!VERSION_SITE : NATIVE_AVEC_MISES_A_JOUR;

  const controler = useCallback(() => {
    verifier().then(
      (oui) => {
        if (oui) setDisponible(true);
      },
      () => undefined, // Hors ligne : nouvel essai à la prochaine vérification.
    );
  }, []);

  useEffect(() => {
    if (!actif) return;
    controler();
    const minuterie = setInterval(controler, VERIFICATION_MS);
    // Retour sur l'application (onglet ou téléphone) et retour du réseau : on revérifie.
    const etat = AppState.addEventListener('change', (e) => {
      if (e === 'active') controler();
    });
    const enLigne = () => controler();
    if (WEB) {
      window.addEventListener('online', enLigne);
      window.addEventListener('focus', enLigne);
    }
    return () => {
      clearInterval(minuterie);
      etat.remove();
      if (WEB) {
        window.removeEventListener('online', enLigne);
        window.removeEventListener('focus', enLigne);
      }
    };
  }, [actif, controler]);

  // « Plus tard » : le bandeau se cache, puis revient au bout de REPORT_MS.
  useEffect(() => {
    if (!reporte) return;
    const minuterie = setTimeout(() => setReporte(false), REPORT_MS);
    return () => clearTimeout(minuterie);
  }, [reporte]);

  if (!disponible || reporte) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.bandeau, { backgroundColor: c.enTete, paddingTop: marges.top + 8 }]}
    >
      <Ionicons name="cloud-download" size={24} color={c.accent} />
      <View style={styles.texte}>
        <Text style={[styles.titre, { color: c.texteEnTete }]}>Nouvelle version disponible</Text>
        <Text style={{ color: c.texteEnTete }}>
          Mettez à jour pour avoir les dernières améliorations. Vos données restent sur l’appareil.
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          disabled={installation}
          onPress={() => {
            setInstallation(true);
            installer().catch(() => setInstallation(false));
          }}
          style={({ pressed }) => [
            styles.bouton,
            { backgroundColor: c.accent, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          {installation ? (
            <ActivityIndicator size="small" color="#1E2235" />
          ) : (
            <Ionicons name="refresh" size={18} color="#1E2235" />
          )}
          <Text style={styles.texteBouton}>Mettre à jour</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setReporte(true)}
          style={({ pressed }) => [styles.plusTard, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={{ color: c.texteEnTete, textDecorationLine: 'underline' }}>Plus tard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  texte: { flex: 1, minWidth: 200, gap: 2 },
  titre: { fontSize: 16, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bouton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  // Texte foncé sur le bouton ambre (comme la variante « accent » de Bouton), deux modes.
  texteBouton: { color: '#1E2235', fontWeight: '800' },
  plusTard: { paddingVertical: 6 },
});
