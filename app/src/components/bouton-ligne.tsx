import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useCouleurs } from '@/lib/theme';

/** Petit bouton encadré d'une ligne de liste (Modifier, Imprimer…). */
export function BoutonLigne({
  titre,
  icone,
  surAppui,
  libelleAccessible,
  chargement = false,
}: {
  titre: string;
  icone: ComponentProps<typeof Ionicons>['name'];
  surAppui: () => void;
  libelleAccessible: string;
  chargement?: boolean;
}) {
  const c = useCouleurs();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={libelleAccessible}
      disabled={chargement}
      onPress={surAppui}
      style={({ pressed }) => [
        styles.bouton,
        { borderColor: c.primaire, opacity: pressed || chargement ? 0.6 : 1 },
      ]}
    >
      {chargement ? (
        <ActivityIndicator size="small" color={c.primaire} />
      ) : (
        <Ionicons name={icone} size={18} color={c.primaire} />
      )}
      <Text style={{ color: c.primaire, fontWeight: '700' }}>{titre}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bouton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
