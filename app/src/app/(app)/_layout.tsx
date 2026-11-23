import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarreOnglets } from '@/components/barre-onglets';
import { IndicateurSync } from '@/components/indicateur-sync';
import { useCouleurs } from '@/lib/theme';

/**
 * Écrans de l'application : bandeau de synchronisation en haut, barre d'onglets en bas
 * (Accueil, Stock, Vendre, Clients, Menu), toujours au même endroit.
 */
export default function LayoutApplication() {
  const c = useCouleurs();
  return (
    <>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.enTete }}>
        <IndicateurSync />
      </SafeAreaView>
      <Stack screenOptions={{ headerShown: false }} />
      <BarreOnglets />
    </>
  );
}
