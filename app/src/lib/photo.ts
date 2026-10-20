import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { ClientApi } from './api';

/** Largeur des photos envoyées : assez pour une fiche, légère sur une connexion lente. */
const LARGEUR = 800;
const QUALITE = 0.7;

/**
 * Choisit (galerie) ou prend (caméra) une photo, la réduit et la compresse en JPEG.
 * Renvoie son adresse locale, ou null si l'utilisateur a annulé.
 */
export async function choisirPhoto(source: 'galerie' | 'camera'): Promise<string | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Autorisez la caméra pour photographier le produit.');
  }
  const resultat =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (resultat.canceled || !resultat.assets[0]) return null;
  const image = await ImageManipulator.manipulate(resultat.assets[0].uri)
    .resize({ width: LARGEUR })
    .renderAsync();
  const enregistree = await image.saveAsync({ compress: QUALITE, format: SaveFormat.JPEG });
  return enregistree.uri;
}

/** Envoie la photo d'un produit (en ligne seulement). */
export async function envoyerPhoto(api: ClientApi, produitId: string, uri: string): Promise<void> {
  const formulaire = new FormData();
  if (Platform.OS === 'web') {
    formulaire.append('photo', await (await fetch(uri)).blob(), 'photo.jpg');
  } else {
    // React Native lit le fichier à partir de son adresse locale.
    formulaire.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  await api.requete(`/catalogue/produits/${produitId}/photo`, {
    methode: 'PUT',
    corps: formulaire,
  });
}
