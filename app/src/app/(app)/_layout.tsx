import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IndicateurSync } from '@/components/indicateur-sync';
import { useCouleurs } from '@/lib/theme';

/** Écrans de l'application, sous le bandeau permanent de synchronisation. */
export default function LayoutApplication() {
  const c = useCouleurs();
  return (
    <>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.enTete }}>
        <IndicateurSync />
      </SafeAreaView>
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
