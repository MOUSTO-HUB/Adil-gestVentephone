import { bonCommandeHtml, type DocumentBonCommande, texteBonCommande } from '@gestvente/commun';
import { useState } from 'react';
import { Platform } from 'react-native';
import { Bouton, Carte, Message } from '@/components/ui';
import { chargerBonCommande } from '@/lib/achats';
import { envoyerTexte, imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';

type Action = 'imprimer' | 'pdf' | 'whatsapp';

/** Charge le bon de commande imprimable depuis la base locale. */
export function useChargerBon() {
  const { profil, boutique } = useSession();
  const { base } = useSync();
  return async (achatId: string): Promise<DocumentBonCommande> => {
    const d =
      base && profil && boutique
        ? await chargerBonCommande(base, achatId, {
            commerce: profil.commerce.nom,
            boutique,
            monnaie: profil.commerce.monnaie,
            emisPar: profil.nom,
          })
        : null;
    if (!d) throw new Error('Bon de commande introuvable sur cet appareil.');
    return d;
  };
}

/** Imprime le bon (sur ordinateur, la fenêtre d'impression permet « Enregistrer en PDF »). */
export async function imprimerBon(d: DocumentBonCommande) {
  await imprimerHtml(bonCommandeHtml(d));
}

/**
 * Bon de commande : impression (ou PDF sur ordinateur), partage du PDF sur téléphone,
 * résumé envoyé au fournisseur par WhatsApp.
 */
export function DocumentsBon({ achatId }: { achatId: string }) {
  const charger = useChargerBon();
  const [enCours, setEnCours] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);

  const lancer = async (action: Action, tache: (d: DocumentBonCommande) => Promise<void>) => {
    setMessage(null);
    setEnCours(action);
    try {
      await tache(await charger(achatId));
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnCours(null);
    }
  };

  return (
    <Carte titre="Bon de commande (PDF)" icone="document-text">
      <Bouton
        titre={Platform.OS === 'web' ? 'Imprimer ou enregistrer en PDF' : 'Imprimer'}
        icone="print"
        chargement={enCours === 'imprimer'}
        onPress={() => void lancer('imprimer', imprimerBon)}
      />
      {partagePdfDisponible ? (
        <Bouton
          titre="Partager le PDF (WhatsApp, e-mail…)"
          icone="share-social"
          variante="secondaire"
          chargement={enCours === 'pdf'}
          onPress={() =>
            void lancer('pdf', (d) =>
              partagerPdf(bonCommandeHtml(d), `Bon de commande ${d.numero}`),
            )
          }
        />
      ) : null}
      <Bouton
        titre="Envoyer par WhatsApp"
        icone="logo-whatsapp"
        variante="secondaire"
        chargement={enCours === 'whatsapp'}
        onPress={() =>
          void lancer('whatsapp', (d) =>
            envoyerTexte('whatsapp', d.fournisseur.telephone, texteBonCommande(d)),
          )
        }
      />
      <Message texte={message?.texte ?? null} type={message?.type} />
    </Carte>
  );
}
