import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

/**
 * Impression classique (ordinateur, imprimante du système) et partage de la facture.
 * Sur ordinateur (web), le document est imprimé depuis un cadre caché : la boîte
 * d'impression du navigateur permet aussi de l'enregistrer en PDF.
 */

/** 1 mm en points d'impression (72 points par pouce). */
const POINTS_PAR_MM = 72 / 25.4;

function imprimerDansLeNavigateur(html: string): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const cadre = document.createElement('iframe');
    cadre.setAttribute('aria-hidden', 'true');
    cadre.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
    cadre.onload = () => {
      const fenetre = cadre.contentWindow;
      if (!fenetre) {
        cadre.remove();
        rejeter(new Error('Impression impossible dans ce navigateur.'));
        return;
      }
      fenetre.addEventListener('afterprint', () => setTimeout(() => cadre.remove(), 500));
      fenetre.focus();
      fenetre.print();
      resoudre();
    };
    cadre.srcdoc = html;
    document.body.appendChild(cadre);
  });
}

/** Imprime un document HTML ; `largeurMm` pour un reçu sur rouleau (58 ou 80 mm). */
export async function imprimerHtml(html: string, largeurMm?: number): Promise<void> {
  if (Platform.OS === 'web') return imprimerDansLeNavigateur(html);
  await Print.printAsync({
    html,
    ...(largeurMm ? { width: Math.round(largeurMm * POINTS_PAR_MM) } : {}),
  });
}

/** Le partage d'un fichier PDF n'existe que sur téléphone (sur ordinateur : imprimer en PDF). */
export const partagePdfDisponible = Platform.OS !== 'web';

/** Crée le PDF de la facture et ouvre le partage (WhatsApp, SMS/MMS, e-mail, Bluetooth…). */
export async function partagerPdf(html: string, titre: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  }
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: titre,
  });
}

/** Ouvre WhatsApp ou l'application SMS avec le résumé de la vente, vers le client si connu. */
export async function envoyerTexte(
  canal: 'whatsapp' | 'sms',
  telephone: string | null,
  texte: string,
): Promise<void> {
  const message = encodeURIComponent(texte);
  const url =
    canal === 'whatsapp'
      ? `https://wa.me/${telephone ? telephone.replace(/\D/g, '') : ''}?text=${message}`
      : `sms:${telephone ?? ''}${Platform.OS === 'ios' ? '&' : '?'}body=${message}`;
  try {
    await Linking.openURL(url);
  } catch {
    throw new Error(
      canal === 'whatsapp'
        ? 'WhatsApp n’a pas pu être ouvert.'
        : 'Aucune application SMS sur cet appareil.',
    );
  }
}
