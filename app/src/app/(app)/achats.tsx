import { formaterMontant } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, Ecran, Texte } from '@/components/ui';
import { achatsDeLaBoutique, LIBELLES_STATUTS_ACHAT } from '@/lib/achats';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

/** Bons d'achat de la boutique (hors ligne) : réception, paiements. */
export default function Achats() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const achats = useLecture((b) => achatsDeLaBoutique(b, boutique?.id ?? ''), [boutique?.id]);
  const monnaie = profil?.commerce.monnaie;

  return (
    <Ecran titre="Achats" sousTitre={boutique?.nom} enHaut>
      <Bouton titre="Nouveau bon d’achat" onPress={() => router.push('/achat/edition')} />
      {achats?.length === 0 ? <Texte discret>Aucun bon d’achat.</Texte> : null}
      {achats?.map((a) => {
        const reste = a.statut === 'ANNULE' ? 0 : a.montantTotal - a.montantPaye;
        const aRecevoir = a.statut === 'BROUILLON' || a.statut === 'PARTIEL';
        return (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/achat/[id]', params: { id: a.id } })}
            style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View style={styles.texte}>
              <Text style={[styles.nom, { color: colors.text }]}>
                {a.numero} · {a.fournisseur}
              </Text>
              <Text style={{ color: colors.text, opacity: 0.65 }}>
                {new Date(`${a.dateAchat}T12:00:00`).toLocaleDateString('fr-FR')} ·{' '}
                {formaterMontant(a.montantTotal, monnaie)}
                {reste > 0 ? ` · reste ${formaterMontant(reste, monnaie)}` : ''}
              </Text>
            </View>
            <Text style={[styles.statut, { color: aRecevoir ? colors.primary : colors.text }]}>
              {LIBELLES_STATUTS_ACHAT[a.statut]}
            </Text>
          </Pressable>
        );
      })}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  texte: { flex: 1, gap: 2 },
  nom: { fontSize: 16, fontWeight: '600' },
  statut: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
});
