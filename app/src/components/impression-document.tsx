import { type LargeurRecu, type LigneRecu, recuEscPos } from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Bouton, Message } from '@/components/ui';
import type { ReglagesImpression } from '@/lib/documents';
import { imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { bluetoothDisponible, imprimerBluetooth } from '@/lib/imprimante-bluetooth';

type Action = 'bluetooth' | 'ticket' | 'a4' | 'pdf';

/**
 * Boutons d'impression d'un document : ticket thermique (Bluetooth ou imprimante du
 * système) et/ou page A4 (impression ou PDF partagé).
 */
export function ImpressionDocument({
  titre,
  reglages,
  ticket,
  a4,
}: {
  titre: string;
  reglages: ReglagesImpression;
  ticket?: {
    lignes: (largeur: LargeurRecu) => LigneRecu[];
    html: (largeur: LargeurRecu) => string;
  };
  a4?: () => string;
}) {
  const [enCours, setEnCours] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);

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
    <>
      {ticket && bluetoothDisponible ? (
        reglages.imprimante ? (
          <Bouton
            titre={`Imprimer le ticket (${reglages.imprimante.nom})`}
            icone="print"
            chargement={enCours === 'bluetooth'}
            onPress={() =>
              void lancer(
                'bluetooth',
                () =>
                  imprimerBluetooth(
                    reglages.imprimante!.id,
                    recuEscPos(ticket.lignes(reglages.largeur)),
                  ),
                'Ticket imprimé.',
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
      {ticket ? (
        <Bouton
          titre={`Ticket ${reglages.largeur} mm`}
          icone="receipt-outline"
          variante="secondaire"
          chargement={enCours === 'ticket'}
          onPress={() =>
            void lancer('ticket', () =>
              imprimerHtml(ticket.html(reglages.largeur), reglages.largeur),
            )
          }
        />
      ) : null}
      {a4 ? (
        <Bouton
          titre={`${titre} (A4)`}
          icone="document-text-outline"
          variante="secondaire"
          chargement={enCours === 'a4'}
          onPress={() => void lancer('a4', () => imprimerHtml(a4()))}
        />
      ) : null}
      {a4 && partagePdfDisponible ? (
        <Bouton
          titre={`Partager : ${titre.toLowerCase()} (PDF)`}
          icone="share-outline"
          variante="secondaire"
          chargement={enCours === 'pdf'}
          onPress={() => void lancer('pdf', () => partagerPdf(a4(), titre))}
        />
      ) : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
    </>
  );
}
