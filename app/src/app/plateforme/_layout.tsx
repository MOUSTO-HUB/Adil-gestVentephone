import { Stack } from 'expo-router';
import { BarreConcepteur } from '@/components/barre-onglets';
import { ActivityIndicator, View } from 'react-native';
import { FournisseurPlateforme, usePlateforme } from '@/lib/plateforme';

/** Espace concepteur : sans session, seul l'écran d'accueil (connexion) est ouvert. */
function Navigation() {
  const { chargement, session } = usePlateforme();
  if (chargement) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="nouveau" />
          <Stack.Screen name="tableau" />
          <Stack.Screen name="commerce/[id]" />
          <Stack.Screen name="compte" />
          <Stack.Screen name="concepteurs" />
          <Stack.Screen name="demandes" />
          <Stack.Screen name="appareils" />
        </Stack.Protected>
      </Stack>
      {/* Barre d'onglets une fois connecté (Commerçants, Nouveau, Tableau de bord, Quitter). */}
      {session ? <BarreConcepteur /> : null}
    </>
  );
}

export default function LayoutPlateforme() {
  return (
    <FournisseurPlateforme>
      <Navigation />
    </FournisseurPlateforme>
  );
}
