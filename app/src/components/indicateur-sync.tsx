import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { type ColorValue, Pressable, StyleSheet, Text, View } from 'react-native';
import { peutGererSessions } from '@gestvente/commun';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

/**
 * Bandeau permanent : en ligne, hors ligne, synchronisation en cours, opérations
 * en attente, refusées ou en conflit. Un appui ouvre le détail.
 */
export function IndicateurSync() {
  const c = useCouleurs();
  const { profil } = useSession();
  const { etat, conflits } = useSync();
  // Le gérant voit tous les conflits de ses boutiques (les siens compris) ; les autres, ceux de cet appareil.
  const gestion = !!profil && peutGererSessions(profil.role);

  const morceaux: string[] = [];
  let couleur: ColorValue = c.texteDiscret;
  if (etat.enCours) morceaux.push('Synchronisation…');
  else if (etat.reseau === 'en-ligne') {
    morceaux.push('En ligne');
    couleur = c.succes;
  } else if (etat.reseau === 'hors-ligne') {
    morceaux.push('Hors ligne');
    couleur = c.alerte;
  } else morceaux.push('Connexion…');
  if (etat.enAttente > 0) morceaux.push(`${etat.enAttente} en attente`);
  const aTraiter = etat.refusees + (gestion ? conflits : etat.enConflit);
  if (aTraiter > 0) {
    morceaux.push(`${aTraiter} à vérifier`);
    couleur = c.danger;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`État de la synchronisation : ${morceaux.join(', ')}`}
      onPress={() => router.push('/synchronisation')}
      style={[styles.bandeau, { backgroundColor: c.enTete }]}
    >
      <View style={[styles.pastille, { backgroundColor: couleur }]} />
      <Text style={[styles.texte, { color: c.texteEnTete }]} numberOfLines={1}>
        {morceaux.join(' · ')}
      </Text>
      <Ionicons name="sync" size={16} color={c.texteEnTete} style={{ opacity: 0.7 }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pastille: { width: 10, height: 10, borderRadius: 5 },
  texte: { fontSize: 14, flex: 1, opacity: 0.9 },
});
