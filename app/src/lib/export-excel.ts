import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { ClientApi } from './api';

/** Télécharge un classeur Excel du serveur : enregistré (ordinateur) ou partagé (téléphone). */
export async function exporterExcel(api: ClientApi, chemin: string, nomFichier: string) {
  const blob = await api.requete<Blob>(chemin, { fichier: true });
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nomFichier;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const base64 = await new Promise<string>((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result).split(',')[1] ?? '');
    lecteur.onerror = () => rejeter(new Error('Fichier illisible.'));
    lecteur.readAsDataURL(blob);
  });
  const fichier = new File(Paths.cache, nomFichier);
  fichier.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(fichier.uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: nomFichier,
  });
}
