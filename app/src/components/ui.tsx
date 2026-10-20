import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
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
import { ombre, useCouleurs } from '@/lib/theme';

export type NomIcone = ComponentProps<typeof Ionicons>['name'];

/** Logo de l'application (écrans de connexion et de code PIN). */
export function Logo() {
  const c = useCouleurs();
  return (
    <View style={styles.logo}>
      <View style={[styles.pastilleLogo, { backgroundColor: c.enTete }]}>
        <Ionicons name="phone-portrait" size={34} color={c.accent} />
      </View>
      <Text style={[styles.nomLogo, { color: c.texte }]}>
        GestVente <Text style={{ color: c.primaire }}>Phone</Text>
      </Text>
    </View>
  );
}

/**
 * Écran limité en largeur sur ordinateur, qui remonte au-dessus du clavier.
 * `enHaut` : écran de l'application, avec un en-tête coloré (titre, retour) sous le
 * bandeau de synchronisation ; sinon contenu centré sous le logo (connexion, PIN).
 */
export function Ecran({
  titre,
  sousTitre,
  enHaut = false,
  retour = true,
  children,
}: {
  titre: string;
  sousTitre?: string;
  enHaut?: boolean;
  /** Flèche de retour dans l'en-tête (si l'écran précédent existe). */
  retour?: boolean;
  children: ReactNode;
}) {
  const c = useCouleurs();
  const flecheRetour = enHaut && retour && router.canGoBack();
  return (
    <SafeAreaView
      edges={enHaut ? ['left', 'right', 'bottom'] : undefined}
      style={[styles.ecran, { backgroundColor: c.fond }]}
    >
      <KeyboardAvoidingView
        style={styles.ecran}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.defilement, enHaut && styles.defilementHaut]}
          keyboardShouldPersistTaps="handled"
        >
          {enHaut ? (
            <View style={[styles.enTete, { backgroundColor: c.enTete }]}>
              <View style={[styles.colonne, styles.ligneEnTete]}>
                {flecheRetour ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retour"
                    hitSlop={10}
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.boutonRetour, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Ionicons name="chevron-back" size={26} color={c.texteEnTete} />
                  </Pressable>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text
                    accessibilityRole="header"
                    style={[styles.titre, { color: c.texteEnTete }]}
                    numberOfLines={2}
                  >
                    {titre}
                  </Text>
                  {sousTitre ? (
                    <Text style={[styles.sousTitre, { color: c.texteEnTete }]} numberOfLines={1}>
                      {sousTitre}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
          <View style={[styles.colonne, styles.contenu]}>
            {!enHaut ? (
              <>
                <Logo />
                <Text accessibilityRole="header" style={[styles.titreCentre, { color: c.texte }]}>
                  {titre}
                </Text>
                {sousTitre ? (
                  <Text style={[styles.sousTitreCentre, { color: c.texteDiscret }]}>
                    {sousTitre}
                  </Text>
                ) : null}
              </>
            ) : null}
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Champ({ libelle, ...props }: TextInputProps & { libelle: string }) {
  const c = useCouleurs();
  return (
    <View style={styles.champ}>
      <Text style={[styles.libelle, { color: c.texteDiscret }]}>{libelle}</Text>
      <TextInput
        placeholderTextColor={c.texteDiscret}
        {...props}
        style={[
          styles.saisie,
          { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
        ]}
      />
    </View>
  );
}

type Variante = 'principal' | 'secondaire' | 'danger' | 'accent';

export function Bouton({
  titre,
  onPress,
  chargement = false,
  desactive = false,
  variante = 'principal',
  icone,
}: {
  titre: string;
  onPress: () => void;
  chargement?: boolean;
  desactive?: boolean;
  variante?: Variante;
  icone?: NomIcone;
}) {
  const c = useCouleurs();
  const [fond, texte] =
    variante === 'principal'
      ? [c.bouton, '#FFFFFF']
      : variante === 'accent'
        ? [c.accent, '#1E2235']
        : variante === 'danger'
          ? [c.danger, '#FFFFFF']
          : [c.fondPrimaire, c.primaire];
  const inactif = desactive || chargement;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactif, busy: chargement }}
      disabled={inactif}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bouton,
        variante !== 'secondaire' && ombre(c.ombre, 2),
        {
          backgroundColor: fond,
          opacity: inactif ? 0.5 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {chargement ? (
        <ActivityIndicator color={texte} />
      ) : (
        <>
          {icone ? <Ionicons name={icone} size={20} color={texte} /> : null}
          <Text style={[styles.texteBouton, { color: texte }]}>{titre}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Message({
  texte,
  type = 'erreur',
}: {
  texte: string | null;
  type?: 'erreur' | 'info' | 'succes';
}) {
  const c = useCouleurs();
  if (!texte) return null;
  const [fond, couleur, icone]: [string, string, NomIcone] =
    type === 'erreur'
      ? [c.fondDanger, c.danger, 'alert-circle']
      : type === 'succes'
        ? [c.fondSucces, c.succes, 'checkmark-circle']
        : [c.fondPrimaire, c.primaire, 'information-circle'];
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.message, { backgroundColor: fond, borderLeftColor: couleur }]}
    >
      <Ionicons name={icone} size={20} color={couleur} />
      <Text style={[styles.texteMessage, { color: c.texte }]}>{texte}</Text>
    </View>
  );
}

export function Carte({
  children,
  titre,
  icone,
}: {
  children: ReactNode;
  titre?: string;
  icone?: NomIcone;
}) {
  const c = useCouleurs();
  return (
    <View
      style={[
        styles.carte,
        ombre(c.ombre, 1),
        { backgroundColor: c.carte, borderColor: c.bordure },
      ]}
    >
      {titre ? (
        <View style={styles.titreCarte}>
          {icone ? <Ionicons name={icone} size={18} color={c.primaire} /> : null}
          <Text style={[styles.texteTitreCarte, { color: c.texte }]}>{titre}</Text>
        </View>
      ) : null}
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
  const c = useCouleurs();
  return (
    <Text
      style={[
        styles.texte,
        { color: discret ? c.texteDiscret : c.texte, fontWeight: gras ? '600' : '400' },
      ]}
    >
      {children}
    </Text>
  );
}

/** Titre d'un groupe d'écrans ou de tuiles. */
export function Section({ titre }: { titre: string }) {
  const c = useCouleurs();
  return <Text style={[styles.section, { color: c.texteDiscret }]}>{titre.toUpperCase()}</Text>;
}

/** Tuile du menu d'accueil : icône colorée et libellé, badge facultatif. */
export function Tuile({
  titre,
  icone,
  onPress,
  couleur,
  badge,
}: {
  titre: string;
  icone: NomIcone;
  onPress: () => void;
  couleur?: string;
  badge?: number;
}) {
  const c = useCouleurs();
  const teinte = couleur ?? c.primaire;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${titre} (${badge})` : titre}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tuile,
        ombre(c.ombre, 1),
        {
          backgroundColor: c.carte,
          borderColor: c.bordure,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View style={[styles.iconeTuile, { backgroundColor: `${teinte}1F` }]}>
        <Ionicons name={icone} size={26} color={teinte} />
      </View>
      <Text style={[styles.texteTuile, { color: c.texte }]} numberOfLines={2}>
        {titre}
      </Text>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: c.danger }]}>
          <Text style={styles.texteBadge}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Grille de tuiles qui s'adapte à la largeur (2 colonnes sur téléphone, plus sur ordinateur). */
export function Grille({ children }: { children: ReactNode }) {
  return <View style={styles.grille}>{children}</View>;
}

/** Chiffre clé (tableau de bord). */
export function Indicateur({
  libelle,
  valeur,
  detail,
  icone,
  couleur,
  large = false,
}: {
  libelle: string;
  valeur: string;
  detail?: string;
  icone: NomIcone;
  couleur?: string;
  /** Toute la largeur (montants longs). */
  large?: boolean;
}) {
  const c = useCouleurs();
  const teinte = couleur ?? c.primaire;
  return (
    <View
      style={[
        styles.indicateur,
        large && styles.indicateurLarge,
        ombre(c.ombre, 1),
        { backgroundColor: c.carte, borderColor: c.bordure },
      ]}
    >
      <View style={styles.titreCarte}>
        <Ionicons name={icone} size={16} color={teinte} />
        <Text style={[styles.libelleIndicateur, { color: c.texteDiscret }]} numberOfLines={1}>
          {libelle}
        </Text>
      </View>
      <Text style={[styles.valeurIndicateur, { color: c.texte }]} numberOfLines={1}>
        {valeur}
      </Text>
      {detail ? (
        <Text style={[styles.detailIndicateur, { color: teinte }]} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1 },
  defilement: { flexGrow: 1, justifyContent: 'center', paddingBottom: 24 },
  defilementHaut: { justifyContent: 'flex-start' },
  colonne: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  contenu: { gap: 14, paddingHorizontal: 16, paddingTop: 16 },
  enTete: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 },
  ligneEnTete: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boutonRetour: { marginLeft: -6, padding: 2 },
  titre: { fontSize: 24, fontWeight: '800' },
  sousTitre: { fontSize: 15, opacity: 0.8, marginTop: 2 },
  logo: { alignItems: 'center', gap: 10, marginBottom: 8 },
  pastilleLogo: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nomLogo: { fontSize: 24, fontWeight: '800' },
  titreCentre: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sousTitreCentre: { fontSize: 15, textAlign: 'center', marginTop: -6 },
  champ: { gap: 6 },
  libelle: { fontSize: 14, fontWeight: '600' },
  saisie: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
  },
  bouton: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  texteBouton: { fontSize: 16, fontWeight: '700' },
  message: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  texteMessage: { fontSize: 15, flex: 1 },
  carte: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16, gap: 8 },
  titreCarte: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  texteTitreCarte: { fontSize: 17, fontWeight: '700' },
  texte: { fontSize: 16 },
  section: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, marginTop: 8 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tuile: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 140,
    minHeight: 104,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 14,
    gap: 10,
    justifyContent: 'space-between',
  },
  iconeTuile: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteTuile: { fontSize: 15, fontWeight: '700' },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteBadge: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  indicateur: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 140,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  indicateurLarge: { flexBasis: '100%' },
  libelleIndicateur: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  valeurIndicateur: { fontSize: 22, fontWeight: '800' },
  detailIndicateur: { fontSize: 13, fontWeight: '600' },
});
