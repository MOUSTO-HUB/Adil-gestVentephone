import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBasculerApparence } from '@/lib/apparence';
import { texteClair } from '@/lib/erreurs';
import { ombre, useCouleurs, useMode } from '@/lib/theme';

export type NomIcone = ComponentProps<typeof Ionicons>['name'];

/** Bouton ☀️/🌙 : passe du mode clair au mode sombre (choix gardé sur l'appareil). */
export function BoutonApparence({ couleur }: { couleur?: string }) {
  const c = useCouleurs();
  const mode = useMode();
  const basculer = useBasculerApparence();
  const teinte = couleur ?? c.texte;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={mode === 'sombre' ? 'Passer en mode clair' : 'Passer en mode sombre'}
      hitSlop={8}
      onPress={basculer}
      style={({ pressed }) => [
        styles.boutonApparence,
        { borderColor: teinte, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={mode === 'sombre' ? 'sunny' : 'moon'} size={20} color={teinte} />
    </Pressable>
  );
}

/** Logo de l'application (écrans de connexion et de code PIN). */
export function Logo() {
  const c = useCouleurs();
  return (
    <View style={styles.logo}>
      <View style={[styles.pastilleLogo, { backgroundColor: c.enTete }]}>
        <Ionicons name="phone-portrait" size={34} color={c.accent} />
      </View>
      <Text style={[styles.nomLogo, { color: c.texte }]}>
        Gestion vente <Text style={{ color: c.primaire }}>Phone</Text>
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
  large = false,
  children,
}: {
  titre: string;
  sousTitre?: string;
  enHaut?: boolean;
  /** Flèche de retour dans l'en-tête (si l'écran précédent existe). */
  retour?: boolean;
  /** Colonne plus large sur ordinateur (accueil, tableaux de bord). */
  large?: boolean;
  children: ReactNode;
}) {
  const c = useCouleurs();
  const flecheRetour = enHaut && retour && router.canGoBack();
  return (
    <SafeAreaView
      edges={enHaut ? ['left', 'right'] : undefined}
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
              <View style={[styles.colonne, large && styles.colonneLarge, styles.ligneEnTete]}>
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
                <BoutonApparence couleur={c.texteEnTete} />
              </View>
            </View>
          ) : null}
          {enHaut ? (
            <View style={[styles.colonne, large && styles.colonneLarge, styles.contenu]}>
              {children}
            </View>
          ) : (
            <View style={[styles.colonne, styles.colonneEtroite, styles.contenu]}>
              <View style={styles.apparenceCentre}>
                <BoutonApparence />
              </View>
              <Logo />
              <View
                style={[
                  styles.panneau,
                  ombre(c.ombre, 3),
                  { backgroundColor: c.carte, borderColor: c.bordure },
                ]}
              >
                <Text accessibilityRole="header" style={[styles.titreCentre, { color: c.texte }]}>
                  {titre}
                </Text>
                {sousTitre ? (
                  <Text style={[styles.sousTitreCentre, { color: c.texteDiscret }]}>
                    {sousTitre}
                  </Text>
                ) : null}
                {children}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Style commun des zones de saisie (contour franc, plus épais quand le champ est actif). */
export function styleSaisie(
  c: ReturnType<typeof useCouleurs>,
  actif = false,
): TextInputProps['style'] {
  return [
    styles.saisie,
    {
      color: c.texte,
      backgroundColor: c.saisie,
      borderColor: actif ? c.primaire : c.bordureSaisie,
      borderWidth: actif ? 2 : 1.5,
      // Même encombrement actif ou non : la bordure plus épaisse mange le rembourrage.
      paddingHorizontal: actif ? 13.5 : 14,
    },
    Platform.OS === 'web' ? styles.sansContourWeb : null,
  ];
}

/**
 * Champ libellé. Un champ masqué (`secureTextEntry` : mot de passe, code PIN) a un œil
 * pour afficher ou masquer ce qui est saisi (masqué au départ).
 */
export function Champ({ libelle, ...props }: TextInputProps & { libelle: string }) {
  const c = useCouleurs();
  const [actif, setActif] = useState(false);
  const [visible, setVisible] = useState(false);
  const masquable = !!props.secureTextEntry;
  return (
    <View style={styles.champ}>
      <Text style={[styles.libelle, { color: c.texte }]}>{libelle}</Text>
      <View style={styles.cadreChamp}>
        <TextInput
          placeholderTextColor={c.texteDiscret}
          accessibilityLabel={libelle}
          {...props}
          secureTextEntry={masquable && !visible}
          onFocus={(e) => {
            setActif(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setActif(false);
            // Espaces au début et à la fin retirés en quittant le champ (identifiant, mot de
            // passe et toute autre saisie) ; le serveur les retire aussi.
            if (typeof props.value === 'string' && props.value !== props.value.trim()) {
              props.onChangeText?.(props.value.trim());
            }
            props.onBlur?.(e);
          }}
          style={[styleSaisie(c, actif), masquable && styles.saisieAvecOeil]}
        />
        {masquable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? `Masquer : ${libelle}` : `Afficher : ${libelle}`}
            hitSlop={8}
            onPress={() => setVisible((v) => !v)}
            style={({ pressed }) => [styles.oeil, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={c.texteDiscret}
            />
          </Pressable>
        ) : null}
      </View>
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
  const [fond, texte, contour] =
    variante === 'principal'
      ? [c.bouton, '#FFFFFF', c.bouton]
      : variante === 'accent'
        ? [c.accent, '#1E2235', c.accent]
        : variante === 'danger'
          ? [c.boutonDanger, '#FFFFFF', c.boutonDanger]
          : [c.carte, c.primaire, c.primaire];
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
          borderColor: contour,
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
  // Dernier filet : une erreur technique (anglais, code) devient une phrase simple.
  const affiche = type === 'erreur' ? texteClair(texte) : texte;
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
      <Text style={[styles.texteMessage, { color: c.texte }]}>{affiche}</Text>
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

/** Titre d'un groupe d'écrans ou de tuiles : barre de couleur, icône facultative. */
export function Section({ titre, icone }: { titre: string; icone?: NomIcone }) {
  const c = useCouleurs();
  return (
    <View style={styles.ligneSection}>
      <View style={[styles.barreSection, { backgroundColor: c.primaire }]} />
      {icone ? <Ionicons name={icone} size={18} color={c.primaire} /> : null}
      <Text accessibilityRole="header" style={[styles.section, { color: c.texte }]}>
        {titre}
      </Text>
      <View style={[styles.filetSection, { backgroundColor: c.bordure }]} />
    </View>
  );
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
          backgroundColor: pressed ? c.fondPrimaire : c.carte,
          borderColor: pressed ? c.primaire : c.bordure,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={[styles.iconeTuile, { backgroundColor: `${teinte}24` }]}>
        <Ionicons name={icone} size={22} color={teinte} />
      </View>
      <Text style={[styles.texteTuile, { color: c.texte }]} numberOfLines={2}>
        {titre}
      </Text>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: c.boutonDanger }]}>
          <Text style={styles.texteBadge}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={c.texteDiscret} />
    </Pressable>
  );
}

/**
 * Grande tuile d'action (accueil) : gros pictogramme sur fond coloré et un mot court,
 * lisible sans savoir bien lire. 2 par ligne sur téléphone, 4 sur ordinateur.
 */
export function GrandeTuile({
  titre,
  icone,
  onPress,
  couleur,
  badge,
  plein = false,
  petite = false,
}: {
  titre: string;
  icone: NomIcone;
  onPress: () => void;
  couleur?: string;
  badge?: number;
  /** Fond entièrement coloré (action principale, ex. Vendre). */
  plein?: boolean;
  /** Version réduite (écran Menu) : 3 par ligne sur téléphone, 6 sur ordinateur. */
  petite?: boolean;
}) {
  const c = useCouleurs();
  const { width } = useWindowDimensions();
  // Largeur fixe selon l'écran : une tuile seule sur sa ligne ne s'étire pas.
  const colonnes = petite ? (width < 520 ? 3 : width < 900 ? 4 : 6) : width < 700 ? 2 : 4;
  // Sur ordinateur, la barre de défilement mange une partie de la largeur (pas sur téléphone).
  const grille =
    Math.min(width - (Platform.OS === 'web' && width >= 700 ? 18 : 0), LARGEUR_LARGE) - 32;
  const cote = Math.floor((grille - ECART_GRILLE * (colonnes - 1)) / colonnes);
  const taille = { width: cote, height: petite ? Math.min(cote, 120) : Math.min(cote / 1.15, 180) };
  const teinte = couleur ?? c.primaire;
  const texte = plein ? '#FFFFFF' : c.texte;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${titre} (${badge})` : titre}
      onPress={onPress}
      style={({ pressed }) => [
        styles.grandeTuile,
        petite && styles.petiteTuile,
        taille,
        ombre(c.ombre, petite ? 1 : 2),
        {
          backgroundColor: plein ? teinte : c.carte,
          borderColor: plein ? teinte : `${teinte}66`,
          transform: [{ scale: pressed ? 0.97 : 1 }],
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconeGrandeTuile,
          petite && styles.iconePetiteTuile,
          { backgroundColor: plein ? 'rgba(255,255,255,0.22)' : `${teinte}22` },
        ]}
      >
        <Ionicons name={icone} size={petite ? 26 : 38} color={plein ? '#FFFFFF' : teinte} />
      </View>
      <Text
        style={[styles.texteGrandeTuile, petite && styles.textePetiteTuile, { color: texte }]}
        numberOfLines={2}
      >
        {titre}
      </Text>
      {badge ? (
        <View style={[styles.badgeGrandeTuile, { backgroundColor: c.boutonDanger }]}>
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
  compact = false,
}: {
  libelle: string;
  valeur: string;
  detail?: string;
  icone: NomIcone;
  couleur?: string;
  /** Toute la largeur (montants longs). */
  large?: boolean;
  /** Plus petit (accueil sur téléphone : les actions restent visibles sans défiler). */
  compact?: boolean;
}) {
  const c = useCouleurs();
  const teinte = couleur ?? c.primaire;
  return (
    <View
      style={[
        styles.indicateur,
        large && styles.indicateurLarge,
        compact && styles.indicateurCompact,
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
      <Text
        style={[styles.valeurIndicateur, compact && styles.valeurCompacte, { color: c.texte }]}
        numberOfLines={1}
      >
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

/** Largeur maximale de la colonne large (accueil, menu) et écart des grilles. */
const LARGEUR_LARGE = 1040;
const ECART_GRILLE = 10;

const styles = StyleSheet.create({
  ecran: { flex: 1 },
  boutonApparence: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apparenceCentre: { alignItems: 'flex-end', marginBottom: -8 },
  defilement: { flexGrow: 1, justifyContent: 'center', paddingBottom: 28 },
  defilementHaut: { justifyContent: 'flex-start' },
  colonne: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  colonneLarge: { maxWidth: LARGEUR_LARGE },
  colonneEtroite: { maxWidth: 460 },
  contenu: { gap: 14, paddingHorizontal: 16, paddingTop: 18 },
  enTete: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  ligneEnTete: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boutonRetour: { marginLeft: -6, padding: 2 },
  titre: { fontSize: 21, fontWeight: '800' },
  sousTitre: { fontSize: 14, opacity: 0.9, marginTop: 0 },
  logo: { alignItems: 'center', gap: 10, marginBottom: 4 },
  pastilleLogo: {
    width: 68,
    height: 68,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nomLogo: { fontSize: 24, fontWeight: '800' },
  panneau: { borderWidth: 1, borderRadius: 18, padding: 20, gap: 14 },
  titreCentre: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sousTitreCentre: { fontSize: 15, textAlign: 'center', marginTop: -6 },
  champ: { gap: 6 },
  libelle: { fontSize: 14, fontWeight: '600' },
  cadreChamp: { justifyContent: 'center' },
  saisieAvecOeil: { paddingRight: 48 },
  oeil: { position: 'absolute', right: 10, padding: 4 },
  saisie: {
    minHeight: 50,
    borderRadius: 12,
    paddingVertical: 12,
    fontSize: 17,
  },
  // Le contour du champ actif remplace le contour du navigateur.
  sansContourWeb: { outlineStyle: 'none' } as object,
  bouton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1.5,
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
  carte: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  titreCarte: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  texteTitreCarte: { fontSize: 17, fontWeight: '700' },
  texte: { fontSize: 16 },
  ligneSection: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  barreSection: { width: 4, height: 20, borderRadius: 2 },
  section: { fontSize: 16, fontWeight: '800' },
  filetSection: { flex: 1, height: 1, marginLeft: 4 },
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: ECART_GRILLE },
  tuile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 220,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconeTuile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteTuile: { flex: 1, fontSize: 16, fontWeight: '700' },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteBadge: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  grandeTuile: {
    borderWidth: 2,
    borderRadius: 20,
    padding: 12,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconeGrandeTuile: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteGrandeTuile: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  petiteTuile: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 8,
    gap: 6,
  },
  iconePetiteTuile: { width: 50, height: 50, borderRadius: 25 },
  textePetiteTuile: { fontSize: 14, fontWeight: '700' },
  badgeGrandeTuile: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicateur: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 150,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  indicateurLarge: { flexBasis: '100%' },
  indicateurCompact: { paddingVertical: 10, paddingHorizontal: 12, gap: 2, minWidth: 130 },
  valeurCompacte: { fontSize: 19 },
  libelleIndicateur: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  valeurIndicateur: { fontSize: 22, fontWeight: '800' },
  detailIndicateur: { fontSize: 13, fontWeight: '600' },
});
