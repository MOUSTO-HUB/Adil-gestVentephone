import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTheme } from 'expo-router';
import { useRef } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bouton } from './ui';

/** Lecture à la caméra du téléphone ; sur ordinateur, le lecteur USB tape le code dans le champ. */
export const scannerDisponible = Platform.OS !== 'web';

const FORMATS = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] as const;

/** Fenêtre de scan : appelle `surCode` une seule fois avec le code lu, puis se ferme. */
export function Scanner({
  visible,
  surCode,
  fermer,
}: {
  visible: boolean;
  surCode: (code: string) => void;
  fermer: () => void;
}) {
  const { colors } = useTheme();
  const [permission, demander] = useCameraPermissions();
  const lu = useRef(false);

  if (!scannerDisponible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onShow={() => (lu.current = false)}
      onRequestClose={fermer}
    >
      <SafeAreaView style={[styles.ecran, { backgroundColor: colors.background }]}>
        {!permission?.granted ? (
          <View style={styles.permission}>
            <Text style={[styles.texte, { color: colors.text }]}>
              La caméra sert à lire les codes-barres et les IMEI.
            </Text>
            <Bouton titre="Autoriser la caméra" onPress={() => void demander()} />
          </View>
        ) : (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...FORMATS] }}
            onBarcodeScanned={({ data }) => {
              if (lu.current || !data) return;
              lu.current = true;
              surCode(data.trim());
              fermer();
            }}
          />
        )}
        <View style={styles.pied}>
          <Bouton titre="Fermer" variante="secondaire" onPress={fermer} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ecran: { flex: 1 },
  camera: { flex: 1 },
  permission: { flex: 1, justifyContent: 'center', padding: 16, gap: 16 },
  texte: { fontSize: 16, textAlign: 'center' },
  pied: { padding: 16 },
});
