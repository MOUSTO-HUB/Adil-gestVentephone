import { formaterTelephone } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, Champ, Ecran, Texte } from '@/components/ui';
import { rechercherClients } from '@/lib/clients';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

/** Fichier clients (hors ligne) : recherche par nom ou téléphone. */
export default function Clients() {
  const { colors } = useTheme();
  const { profil } = useSession();
  const [recherche, setRecherche] = useState('');
  const [archives, setArchives] = useState(false);
  const clients = useLecture(
    (b) => rechercherClients(b, recherche, archives),
    [recherche, archives],
  );
  const indicatif = profil?.commerce.indicatif;

  return (
    <Ecran titre="Clients" enHaut>
      <Champ
        libelle="Rechercher (nom ou téléphone)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
        returnKeyType="search"
      />
      <Bouton titre="Nouveau client" onPress={() => router.push('/client/edition')} />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: archives }}
        onPress={() => setArchives((a) => !a)}
      >
        <Texte discret>{archives ? '☑' : '☐'} Montrer les clients archivés</Texte>
      </Pressable>
      {clients?.length === 0 ? <Texte discret>Aucun client trouvé.</Texte> : null}
      {clients?.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/client/[id]', params: { id: c.id } })}
          style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={styles.texte}>
            <Text style={[styles.nom, { color: colors.text }]}>
              {c.nom}
              {c.archive ? ' (archivé)' : ''}
            </Text>
            <Text style={{ color: colors.text, opacity: 0.65 }}>
              {formaterTelephone(c.telephone, indicatif)}
            </Text>
          </View>
          {c.type === 'GROSSISTE' ? (
            <Text
              style={[styles.etiquette, { color: colors.primary, borderColor: colors.primary }]}
            >
              Grossiste
            </Text>
          ) : null}
        </Pressable>
      ))}
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
  etiquette: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 13,
    fontWeight: '600',
  },
});
