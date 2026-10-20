import {
  type DocumentVente,
  factureHtml,
  lignesRecu,
  recuEscPos,
  recuHtml,
  texteMessage,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Message, Texte } from '@/components/ui';
import type { ReglagesImpression } from '@/lib/documents';
import { envoyerTexte, imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { bluetoothDisponible, imprimerBluetooth } from '@/lib/imprimante-bluetooth';

type Action = 'bluetooth' | 'recu' | 'facture' | 'pdf' | 'whatsapp' | 'sms';

/** Impression et envoi de la facture ou du reçu d'une vente. */
export function DocumentsVente({
  document: d,
  reglages,
}: {
  document: DocumentVente;
  reglages: ReglagesImpression;
}) {
  const [enCours, setEnCours] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const telephone = d.client?.telephone ?? null;

  const lancer = async (action: Action, tache: () => Promise<void>, reussite?: string) => {
    setMessage(null);
    setEnCours(action);
    try {
      await tache();
      if (reussite) setMessage({ texte: reussite, type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnCours(null);
    }
  };

  return (
    <Carte>
      <Texte gras>Facture et reçu</Texte>
      {bluetoothDisponible ? (
        reglages.imprimante ? (
          <Bouton
            titre={`Imprimer le reçu (${reglages.imprimante.nom})`}
            chargement={enCours === 'bluetooth'}
            onPress={() =>
              void lancer(
                'bluetooth',
                () =>
                  imprimerBluetooth(
                    reglages.imprimante!.id,
                    recuEscPos(lignesRecu(d, reglages.largeur)),
                  ),
                'Reçu imprimé.',
              )
            }
          />
        ) : (
          <Bouton
            titre="Choisir l’imprimante Bluetooth"
            variante="secondaire"
            onPress={() => router.push('/imprimante')}
          />
        )
      ) : null}
      <Bouton
        titre={`Reçu ${reglages.largeur} mm (imprimante du système)`}
        variante="secondaire"
        chargement={enCours === 'recu'}
        onPress={() =>
          void lancer('recu', () => imprimerHtml(recuHtml(d, reglages.largeur), reglages.largeur))
        }
      />
      <Bouton
        titre="Facture A4"
        variante="secondaire"
        chargement={enCours === 'facture'}
        onPress={() => void lancer('facture', () => imprimerHtml(factureHtml(d)))}
      />
      {partagePdfDisponible ? (
        <Bouton
          titre="Partager la facture (PDF)"
          variante="secondaire"
          chargement={enCours === 'pdf'}
          onPress={() =>
            void lancer('pdf', () => partagerPdf(factureHtml(d), `Facture ${d.numero}`))
          }
        />
      ) : null}
      <Bouton
        titre={`WhatsApp${telephone ? ` au ${telephone}` : ''}`}
        variante="secondaire"
        chargement={enCours === 'whatsapp'}
        onPress={() =>
          void lancer('whatsapp', () => envoyerTexte('whatsapp', telephone, texteMessage(d)))
        }
      />
      <Bouton
        titre={`SMS${telephone ? ` au ${telephone}` : ''}`}
        variante="secondaire"
        chargement={enCours === 'sms'}
        onPress={() => void lancer('sms', () => envoyerTexte('sms', telephone, texteMessage(d)))}
      />
      <Message texte={message?.texte ?? null} type={message?.type} />
    </Carte>
  );
}
