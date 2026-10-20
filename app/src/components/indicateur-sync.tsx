import { router, useTheme } from 'expo-router';
import { type ColorValue, Pressable, StyleSheet, Text, View } from 'react-native';
import { peutGererSessions } from '@gestvente/commun';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';

const VERT = '#1f9d55';
const ORANGE = '#d97706';
const GRIS = '#8a8a8a';

/**
 * Bandeau permanent : en ligne, hors ligne, synchronisation en cours, opérations
 * en attente, refusées ou en conflit. Un appui ouvre le détail.
 */
export function IndicateurSync() {
  const { colors } = useTheme();
  const { profil } = useSession();
  const { etat, conflits } = useSync();
  // Le gérant voit tous les conflits de ses boutiques (les siens compris) ; les autres, ceux de cet appareil.
  const gestion = !!profil && peutGererSessions(profil.role);

  const morceaux: string[] = [];
  let couleur: ColorValue = GRIS;
  if (etat.enCours) morceaux.push('Synchronisation…');
  else if (etat.reseau === 'en-ligne') {
    morceaux.push('En ligne');
    couleur = VERT;
  } else if (etat.reseau === 'hors-ligne') {
    morceaux.push('Hors ligne');
    couleur = ORANGE;
  } else morceaux.push('Connexion…');
  if (etat.enAttente > 0) morceaux.push(`${etat.enAttente} en attente`);
  const aTraiter = etat.refusees + (gestion ? conflits : etat.enConflit);
  if (aTraiter > 0) {
    morceaux.push(`${aTraiter} à vérifier`);
    couleur = colors.notification;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`État de la synchronisation : ${morceaux.join(', ')}`}
      onPress={() => router.push('/synchronisation')}
      style={[styles.bandeau, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
    >
      <View style={[styles.pastille, { backgroundColor: couleur }]} />
      <Text style={[styles.texte, { color: colors.text }]} numberOfLines={1}>
        {morceaux.join(' · ')}
      </Text>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pastille: { width: 10, height: 10, borderRadius: 5 },
  texte: { fontSize: 14, flexShrink: 1 },
});
