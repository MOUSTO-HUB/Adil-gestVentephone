import { Image } from 'expo-image';
import { useTheme } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { API_URL } from '@/lib/config';

export const urlPhoto = (photo: string) => `${API_URL}/photos/${encodeURIComponent(photo)}`;

/** Photo d'un produit (gardée en cache sur l'appareil) ou initiale à défaut. */
export function PhotoProduit({
  photo,
  nom,
  taille,
}: {
  photo: string | null;
  nom: string;
  taille: number;
}) {
  const { colors } = useTheme();
  const cadre = { width: taille, height: taille, borderRadius: 8, borderColor: colors.border };
  if (!photo) {
    return (
      <View
        style={[styles.vide, cadre, { backgroundColor: colors.background }]}
        accessibilityLabel="Sans photo"
      >
        <Text style={{ color: colors.text, opacity: 0.5, fontSize: taille / 2.5 }}>
          {nom.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: urlPhoto(photo) }}
      style={[styles.image, cadre]}
      contentFit="cover"
      cachePolicy="disk"
      accessibilityLabel={`Photo : ${nom}`}
    />
  );
}

const styles = StyleSheet.create({
  vide: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  image: { borderWidth: StyleSheet.hairlineWidth },
});
