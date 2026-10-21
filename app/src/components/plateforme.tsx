import { StyleSheet, Text, View } from 'react-native';
import { useCouleurs } from '@/lib/theme';

export const dateCourte = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/** État d'un commerce abonné : en service, suspendu ou retiré. */
export function BadgeStatut({ statut }: { statut: string }) {
  const c = useCouleurs();
  const [libelle, couleur, fond] =
    statut === 'ACTIF'
      ? ['En service', c.succes, c.fondSucces]
      : statut === 'SUSPENDU'
        ? ['Suspendu', c.alerte, c.fondAlerte]
        : ['Retiré', c.danger, c.fondDanger];
  return (
    <View style={[styles.badge, { backgroundColor: fond }]}>
      <Text style={[styles.texte, { color: couleur }]}>{libelle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  texte: { fontWeight: '700', fontSize: 12 },
});
