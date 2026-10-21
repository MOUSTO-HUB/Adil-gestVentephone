import { type ClientApi, ErreurApi } from './api';
import { envoyerImage } from './photo';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoie les photos de l'appareil repris dès que le troc est arrivé sur le serveur
 * (quelques essais). Renvoie le nombre de photos envoyées.
 */
export async function envoyerPhotosTroc(
  api: ClientApi,
  trocId: string,
  uris: string[],
): Promise<number> {
  let envoyees = 0;
  for (const uri of uris) {
    for (let essai = 0; ; essai++) {
      try {
        await envoyerImage(api, `/trocs/${trocId}/photos`, uri, 'POST');
        envoyees++;
        break;
      } catch (e) {
        if (!(e instanceof ErreurApi && e.statut === 404) || essai >= 6) throw e;
        await pause(1500);
      }
    }
  }
  return envoyees;
}
