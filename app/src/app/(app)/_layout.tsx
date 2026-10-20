import { Stack, useTheme } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IndicateurSync } from '@/components/indicateur-sync';

/** Écrans de l'application, sous le bandeau permanent de synchronisation. */
export default function LayoutApplication() {
  const { colors } = useTheme();
  return (
    <>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.card }}>
        <IndicateurSync />
      </SafeAreaView>
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
