import {
  type CanalMessage,
  type DocumentVente,
  factureHtml,
  lignesRecu,
  normaliserTelephone,
  recuEscPos,
  recuHtml,
  texteMessage,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Champ, Message, Section } from '@/components/ui';
import type { ReglagesImpression } from '@/lib/documents';
import { envoyerTexte, imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { bluetoothDisponible, imprimerBluetooth } from '@/lib/imprimante-bluetooth';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';

type Action = 'bluetooth' | 'recu' | 'facture' | 'pdf' | 'whatsapp' | 'sms' | 'serveur';

/**
 * Impression et envoi de la facture d'une vente : imprimante, PDF, envoi automatique
 * par le serveur (SMS ou WhatsApp, même hors ligne) ou depuis les applications du téléphone.
 */
export function DocumentsVente({
  document: d,
  reglages,
  venteId,
}: {
  document: DocumentVente;
  reglages: ReglagesImpression;
  venteId: string;
}) {
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const [enCours, setEnCours] = useState<Action | null>(null);
  const [message, setMessage] = useState<{
    texte: string;
    type: 'erreur' | 'info' | 'succes';
  } | null>(null);
  const [numero, setNumero] = useState('');
  const telephone = d.client?.telephone ?? null;

  const lancer = async (action: Action, tache: () => Promise<void>, reussite?: string) => {
    setMessage(null);
    setEnCours(action);
    try {
      await tache();
      if (reussite) setMessage({ texte: reussite, type: 'succes' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnCours(null);
    }
  };

  /** Le serveur envoie la facture, avec le lien de sa page (garantie comprise). */
  const envoyerParServeur = (canal: CanalMessage) =>
    lancer(
      'serveur',
      async () => {
        let numeroSaisi: string | null = null;
        if (!telephone) {
          numeroSaisi = normaliserTelephone(numero, profil?.commerce.indicatif);
          if (!numeroSaisi) throw new Error('Numéro invalide (ex. 620 11 22 33).');
        }
        await enregistrer({
          type: 'MESSAGE_ENVOYER',
          boutiqueId: boutique?.id ?? '',
          contenu: {
            id: Crypto.randomUUID(),
            venteId,
            type: 'FACTURE',
            canal,
            telephone: numeroSaisi,
          },
        });
      },
      `Facture envoyée par ${canal === 'SMS' ? 'SMS' : 'WhatsApp'} dès que l’appareil est en ligne.`,
    );

  return (
    <Carte titre="Facture et reçu" icone="document-text">
      <Section titre="Imprimer" />
      {bluetoothDisponible ? (
        reglages.imprimante ? (
          <Bouton
            titre={`Imprimer le reçu (${reglages.imprimante.nom})`}
            icone="print"
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
            icone="bluetooth"
            variante="secondaire"
            onPress={() => router.push('/imprimante')}
          />
        )
      ) : null}
      <Bouton
        titre={`Reçu ${reglages.largeur} mm`}
        icone="receipt"
        variante="secondaire"
        chargement={enCours === 'recu'}
        onPress={() =>
          void lancer('recu', () => imprimerHtml(recuHtml(d, reglages.largeur), reglages.largeur))
        }
      />
      <Bouton
        titre="Facture A4"
        icone="document"
        variante="secondaire"
        chargement={enCours === 'facture'}
        onPress={() => void lancer('facture', () => imprimerHtml(factureHtml(d)))}
      />
      {partagePdfDisponible ? (
        <Bouton
          titre="Partager la facture (PDF)"
          icone="share-social"
          variante="secondaire"
          chargement={enCours === 'pdf'}
          onPress={() =>
            void lancer('pdf', () => partagerPdf(factureHtml(d), `Facture ${d.numero}`))
          }
        />
      ) : null}

      {d.statut === 'VALIDEE' ? (
        <>
          <Section titre={`Envoyer au client${telephone ? ` (${telephone})` : ''}`} />
          {!telephone ? (
            <Champ
              libelle="Numéro du client"
              value={numero}
              onChangeText={setNumero}
              keyboardType="phone-pad"
              placeholder="620 11 22 33"
            />
          ) : null}
          <Bouton
            titre="Par SMS"
            icone="chatbox-ellipses"
            chargement={enCours === 'serveur'}
            onPress={() => void envoyerParServeur('SMS')}
          />
          <Bouton
            titre="Par WhatsApp"
            icone="logo-whatsapp"
            variante="secondaire"
            chargement={enCours === 'serveur'}
            onPress={() => void envoyerParServeur('WHATSAPP')}
          />
        </>
      ) : null}

      <Section titre="Depuis ce téléphone" />
      <Bouton
        titre="Ouvrir WhatsApp"
        icone="logo-whatsapp"
        variante="secondaire"
        chargement={enCours === 'whatsapp'}
        onPress={() =>
          void lancer('whatsapp', () => envoyerTexte('whatsapp', telephone, texteMessage(d)))
        }
      />
      <Bouton
        titre="Ouvrir les SMS"
        icone="chatbubbles"
        variante="secondaire"
        chargement={enCours === 'sms'}
        onPress={() => void lancer('sms', () => envoyerTexte('sms', telephone, texteMessage(d)))}
      />
      <Message texte={message?.texte ?? null} type={message?.type} />
    </Carte>
  );
}
