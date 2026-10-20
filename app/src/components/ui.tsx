import { useTheme } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Écran limité en largeur sur ordinateur, qui remonte au-dessus du clavier.
 * `enHaut` : écran de l'application, sous le bandeau de synchronisation (contenu
 * aligné en haut) ; sinon contenu centré (connexion, code PIN).
 */
export function Ecran({
  titre,
  sousTitre,
  enHaut = false,
  children,
}: {
  titre: string;
  sousTitre?: string;
  enHaut?: boolean;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      edges={enHaut ? ['left', 'right', 'bottom'] : undefined}
      style={[styles.ecran, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={styles.ecran}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.defilement, enHaut && styles.defilementHaut]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.colonne}>
            <Text style={[styles.titre, { color: colors.text }]}>{titre}</Text>
            {sousTitre ? (
              <Text style={[styles.sousTitre, { color: colors.text }]}>{sousTitre}</Text>
            ) : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Champ({ libelle, ...props }: TextInputProps & { libelle: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.champ}>
      <Text style={[styles.libelle, { color: colors.text }]}>{libelle}</Text>
      <TextInput
        placeholderTextColor="#8a8a8a"
        {...props}
        style={[
          styles.saisie,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
    </View>
  );
}

type Variante = 'principal' | 'secondaire' | 'danger';

export function Bouton({
  titre,
  onPress,
  chargement = false,
  desactive = false,
  variante = 'principal',
}: {
  titre: string;
  onPress: () => void;
  chargement?: boolean;
  desactive?: boolean;
  variante?: Variante;
}) {
  const { colors } = useTheme();
  const fond =
    variante === 'principal'
      ? colors.primary
      : variante === 'danger'
        ? colors.notification
        : 'transparent';
  const texte = variante === 'secondaire' ? colors.primary : '#ffffff';
  const inactif = desactive || chargement;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactif, busy: chargement }}
      disabled={inactif}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        {
          backgroundColor: fond,
          borderColor: colors.primary,
          opacity: inactif ? 0.5 : pressed ? 0.8 : 1,
        },
        variante === 'secondaire' && styles.boutonSecondaire,
      ]}
    >
      {chargement ? (
        <ActivityIndicator color={texte} />
      ) : (
        <Text style={[styles.texteBouton, { color: texte }]}>{titre}</Text>
      )}
    </Pressable>
  );
}

export function Message({
  texte,
  type = 'erreur',
}: {
  texte: string | null;
  type?: 'erreur' | 'info';
}) {
  const { colors } = useTheme();
  if (!texte) return null;
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.message, { color: type === 'erreur' ? colors.notification : colors.text }]}
    >
      {texte}
    </Text>
  );
}

export function Carte({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.carte, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

export function Texte({
  children,
  discret = false,
  gras = false,
}: {
  children: ReactNode;
  discret?: boolean;
  gras?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        styles.texte,
        { color: colors.text, opacity: discret ? 0.65 : 1, fontWeight: gras ? '600' : '400' },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1 },
  defilement: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  defilementHaut: { justifyContent: 'flex-start' },
  colonne: { width: '100%', maxWidth: 480, alignSelf: 'center', gap: 16 },
  titre: { fontSize: 26, fontWeight: '700' },
  sousTitre: { fontSize: 16, opacity: 0.75 },
  champ: { gap: 6 },
  libelle: { fontSize: 15, fontWeight: '600' },
  saisie: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
  },
  bouton: {
    minHeight: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  boutonSecondaire: { borderWidth: 1.5 },
  texteBouton: { fontSize: 17, fontWeight: '700' },
  message: { fontSize: 15 },
  carte: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 },
  texte: { fontSize: 16 },
});
