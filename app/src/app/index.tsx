import { formaterMontant } from '@gestvente/commun';
import { useTheme } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '@/lib/config';

type EtatApi = 'verification' | 'joignable' | 'injoignable';

const LIBELLES: Record<EtatApi, string> = {
  verification: 'Vérification du serveur…',
  joignable: 'Serveur joignable',
  injoignable: 'Serveur injoignable (hors ligne)',
};

/** Écran d'accueil provisoire : vérifie le lien avec l'API et le code partagé. */
export default function Accueil() {
  const { colors } = useTheme();
  const [etat, setEtat] = useState<EtatApi>('verification');

  useEffect(() => {
    fetch(`${API_URL}/sante`)
      .then((reponse) => setEtat(reponse.ok ? 'joignable' : 'injoignable'))
      .catch(() => setEtat('injoignable'));
  }, []);

  return (
    <SafeAreaView style={[styles.ecran, { backgroundColor: colors.background }]}>
      <View style={styles.contenu}>
        <Text style={[styles.titre, { color: colors.text }]}>GestVente Phone</Text>
        <Text style={[styles.texte, { color: colors.text }]}>
          Gestion de vente de téléphones et d&apos;accessoires
        </Text>
        <Text style={[styles.texte, { color: colors.text }]}>
          Exemple de montant : {formaterMontant(1500000)}
        </Text>
        <Text
          style={[
            styles.etat,
            { color: etat === 'injoignable' ? colors.notification : colors.primary },
          ]}
        >
          {LIBELLES[etat]}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1 },
  contenu: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  titre: { fontSize: 28, fontWeight: '700' },
  texte: { fontSize: 16, textAlign: 'center' },
  etat: { fontSize: 16, fontWeight: '600', marginTop: 8 },
});
