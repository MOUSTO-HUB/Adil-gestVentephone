import { Stack } from 'expo-router';
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
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="nouveau" />
        <Stack.Screen name="commerce/[id]" />
      </Stack.Protected>
    </Stack>
  );
}

export default function LayoutPlateforme() {
  return (
    <FournisseurPlateforme>
      <Navigation />
    </FournisseurPlateforme>
  );
}
