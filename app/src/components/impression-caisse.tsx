import {
  lignesRapportCaisse,
  type RapportCaisse,
  rapportCaisseHtml,
  recuEscPos,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Message, Texte } from '@/components/ui';
import type { ReglagesImpression } from '@/lib/documents';
import { imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { bluetoothDisponible, imprimerBluetooth } from '@/lib/imprimante-bluetooth';

type Action = 'bluetooth' | 'ticket' | 'a4' | 'pdf';

/** Ticket de clôture (80 mm) et rapport A4 / PDF d'une caisse. */
export function ImpressionCaisse({
  rapport,
  reglages,
}: {
  rapport: RapportCaisse;
  reglages: ReglagesImpression;
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

  const ticketHtml = () => {
    const lignes = lignesRapportCaisse(rapport, reglages.largeur)
      .map(
        (l) =>
          `<div style="${l.centre ? 'text-align:center;' : ''}${l.gras ? 'font-weight:bold;' : ''}">${
            l.texte.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '&nbsp;'
          }</div>`,
      )
      .join('');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Clôture de caisse</title>
<style>@page { size: ${reglages.largeur}mm auto; margin: 2mm; } body { margin: 0; font-family: 'Courier New', monospace; font-size: 10pt; } div { white-space: pre; }</style>
</head><body>${lignes}</body></html>`;
  };

  return (
    <Carte>
      <Texte gras>Rapport de clôture</Texte>
      {bluetoothDisponible ? (
        reglages.imprimante ? (
          <Bouton
            titre={`Imprimer le ticket (${reglages.imprimante.nom})`}
            chargement={enCours === 'bluetooth'}
            onPress={() =>
              void lancer(
                'bluetooth',
                () =>
                  imprimerBluetooth(
                    reglages.imprimante!.id,
                    recuEscPos(lignesRapportCaisse(rapport, reglages.largeur)),
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
      <Bouton
        titre={`Ticket ${reglages.largeur} mm (imprimante du système)`}
        variante="secondaire"
        chargement={enCours === 'ticket'}
        onPress={() => void lancer('ticket', () => imprimerHtml(ticketHtml(), reglages.largeur))}
      />
      <Bouton
        titre="Rapport A4"
        variante="secondaire"
        chargement={enCours === 'a4'}
        onPress={() => void lancer('a4', () => imprimerHtml(rapportCaisseHtml(rapport)))}
      />
      {partagePdfDisponible ? (
        <Bouton
          titre="Partager le rapport (PDF)"
          variante="secondaire"
          chargement={enCours === 'pdf'}
          onPress={() =>
            void lancer('pdf', () => partagerPdf(rapportCaisseHtml(rapport), 'Clôture de caisse'))
          }
        />
      ) : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
    </Carte>
  );
}
