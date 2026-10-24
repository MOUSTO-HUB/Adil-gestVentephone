import { type EtatAbonnement, LIBELLES_ETATS_ABONNEMENT } from '@gestvente/commun';
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

/** État de l'abonnement, avec les jours restants (ou de retard). */
export function BadgeAbonnement({
  etat,
  joursRestants,
}: {
  etat: EtatAbonnement;
  joursRestants: number | null;
}) {
  const c = useCouleurs();
  const [couleur, fond] =
    etat === 'EXPIRE' || etat === 'EN_GRACE'
      ? [c.danger, c.fondDanger]
      : etat === 'A_RENOUVELER'
        ? [c.alerte, c.fondAlerte]
        : etat === 'ILLIMITE'
          ? [c.texteDiscret, c.fond]
          : [c.primaire, c.fondPrimaire];
  const jours =
    joursRestants === null
      ? ''
      : joursRestants > 0
        ? ` · ${joursRestants} j`
        : ` · ${-joursRestants} j de retard`;
  return (
    <View style={[styles.badge, { backgroundColor: fond }]}>
      <Text style={[styles.texte, { color: couleur }]}>
        {LIBELLES_ETATS_ABONNEMENT[etat]}
        {etat === 'EXPIRE' ? '' : jours}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  texte: { fontWeight: '700', fontSize: 12 },
});
