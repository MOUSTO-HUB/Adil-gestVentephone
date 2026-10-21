import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FournisseurSession, useSession } from '@/lib/session';
import { FournisseurSync } from '@/lib/sync/contexte';
import { THEME_CLAIR, THEME_SOMBRE } from '@/lib/theme';

/** Chaque écran n'est accessible qu'à la bonne étape de la session. */
function Navigation() {
  const { statut, boutique } = useSession();
  if (statut === 'chargement') {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  const pinRequis = statut === 'pin-a-definir' || statut === 'verrouille';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={statut === 'deconnecte'}>
        <Stack.Screen name="connexion" />
      </Stack.Protected>
      <Stack.Protected guard={pinRequis}>
        <Stack.Screen name="pin" />
      </Stack.Protected>
      <Stack.Protected guard={statut === 'pret' && !boutique}>
        <Stack.Screen name="boutique" />
      </Stack.Protected>
      <Stack.Protected guard={statut === 'pret' && !!boutique}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      {/* Espace concepteur : session propre, aucune donnée de commerce sur l'appareil ; en dernier
          pour que la redirection par défaut reste sur les écrans du commerçant. */}
      <Stack.Screen name="plateforme" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? THEME_SOMBRE : THEME_CLAIR}>
        <StatusBar style="auto" />
        <FournisseurSession>
          <FournisseurSync>
            <Navigation />
          </FournisseurSync>
        </FournisseurSession>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
