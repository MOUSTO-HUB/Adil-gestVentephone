import { formaterMontant } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, Champ, Ecran, Texte } from '@/components/ui';
import { rechercherFournisseurs } from '@/lib/clients';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

/** Fournisseurs (propriétaire et gérants) : coordonnées et reste dû. */
export default function Fournisseurs() {
  const { colors } = useTheme();
  const { profil } = useSession();
  const [recherche, setRecherche] = useState('');
  const fournisseurs = useLecture((b) => rechercherFournisseurs(b, recherche), [recherche]);
  const monnaie = profil?.commerce.monnaie;

  return (
    <Ecran titre="Fournisseurs" enHaut>
      <Champ
        libelle="Rechercher"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
      />
      <Bouton titre="Nouveau fournisseur" onPress={() => router.push('/fournisseur/edition')} />
      {fournisseurs?.length === 0 ? <Texte discret>Aucun fournisseur.</Texte> : null}
      {fournisseurs?.map((f) => (
        <Pressable
          key={f.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/fournisseur/[id]', params: { id: f.id } })}
          style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={styles.texte}>
            <Text style={[styles.nom, { color: colors.text }]}>
              {f.nom}
              {f.archive ? ' (archivé)' : ''}
            </Text>
            {f.telephone ? (
              <Text style={{ color: colors.text, opacity: 0.65 }}>{f.telephone}</Text>
            ) : null}
          </View>
          <Text style={[styles.dette, { color: f.dette > 0 ? colors.notification : colors.text }]}>
            {f.dette > 0 ? `Dû : ${formaterMontant(f.dette, monnaie)}` : 'Rien dû'}
          </Text>
        </Pressable>
      ))}
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
  dette: { fontSize: 14, fontWeight: '600', textAlign: 'right' },
});
