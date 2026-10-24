import { controlerImeis, imeiValide, normaliserImei } from '@gestvente/commun';
import { useTheme } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Scanner, scannerDisponible } from './scanner';
import { Bouton, Message } from './ui';

/**
 * Saisie d'IMEI un par un ou en rafale : le lecteur USB tape l'IMEI puis Entrée,
 * la caméra lit le code-barres ; chaque IMEI est vérifié (clé de Luhn, doublon,
 * déjà connu) avant d'être ajouté à la liste.
 */
export function SaisieImei({
  libelle,
  imeis,
  surChangement,
  dejaConnu = () => false,
  maximum,
  refus,
}: {
  libelle: string;
  imeis: string[];
  surChangement: (imeis: string[]) => void;
  /** IMEI déjà enregistré dans le commerce (réception) : refusé. */
  dejaConnu?: (imei: string) => boolean;
  maximum?: number;
  /** Contrôle propre à l'écran (ex. téléphone absent du transfert) : message, ou null. */
  refus?: (imei: string) => string | null;
}) {
  const { colors } = useTheme();
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [scanner, setScanner] = useState(false);
  const champ = useRef<TextInput>(null);

  const ajouter = (brut: string) => {
    const imei = normaliserImei(brut);
    if (!imei) return;
    const controle = controlerImeis([...imeis, imei], dejaConnu);
    if (!imeiValide(imei))
      setErreur(`${brut} : ce n’est pas un IMEI valide (15 chiffres, clé de contrôle).`);
    else if (controle.doublons.includes(imei)) setErreur(`${imei} est déjà dans la liste.`);
    else if (controle.dejaConnus.includes(imei))
      setErreur(`${imei} est déjà enregistré dans le stock.`);
    else if (refus?.(imei)) setErreur(refus(imei));
    else if (maximum !== undefined && imeis.length >= maximum)
      setErreur(`${maximum} IMEI attendus au plus.`);
    else {
      setErreur(null);
      surChangement([...imeis, imei]);
    }
    setSaisie('');
    champ.current?.focus();
  };

  return (
    <View style={styles.bloc}>
      <Text style={[styles.libelle, { color: colors.text }]}>
        {libelle} ({imeis.length}
        {maximum !== undefined ? ` / ${maximum}` : ''})
      </Text>
      <TextInput
        ref={champ}
        value={saisie}
        onChangeText={setSaisie}
        onSubmitEditing={() => ajouter(saisie)}
        blurOnSubmit={false}
        placeholder="Scannez ou tapez l’IMEI puis Entrée"
        placeholderTextColor="#8a8a8a"
        keyboardType="number-pad"
        accessibilityLabel={`${libelle} : saisir un IMEI`}
        style={[
          styles.saisie,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
        ]}
      />
      {scannerDisponible ? (
        <Bouton titre="Scanner un IMEI" variante="secondaire" onPress={() => setScanner(true)} />
      ) : null}
      <Message texte={erreur} />
      <View style={styles.liste}>
        {imeis.map((imei) => (
          <Pressable
            key={imei}
            accessibilityRole="button"
            accessibilityLabel={`Retirer ${imei}`}
            onPress={() => surChangement(imeis.filter((i) => i !== imei))}
            style={[styles.pastille, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Text style={{ color: colors.text }}>{imei} ✕</Text>
          </Pressable>
        ))}
      </View>
      <Scanner visible={scanner} surCode={ajouter} fermer={() => setScanner(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bloc: { gap: 8 },
  libelle: { fontSize: 15, fontWeight: '600' },
  saisie: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 18,
  },
  liste: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pastille: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
});
