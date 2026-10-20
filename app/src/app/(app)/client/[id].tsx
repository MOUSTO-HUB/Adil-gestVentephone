import {
  type ClientSync,
  formaterMontant,
  formaterTelephone,
  type GarantSync,
  LIBELLES_PIECES,
} from '@gestvente/commun';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { ErreurApi, messageErreur } from '@/lib/api';
import { choisirPhoto, envoyerImage, lireImagePrivee } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface Historique {
  ventes: {
    id: string;
    numero: string;
    date: string;
    total: number;
    statut: string;
    boutique: string;
  }[];
  credits: {
    id: string;
    date: string;
    montantTotal: number;
    montantRestant: number;
    statut: string;
  }[];
  trocs: { id: string; date: string; description: string; valeurRetenue: number }[];
}

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/** Fiche client : coordonnées, pièce d'identité, garant, plafond, historique (en ligne). */
export default function FicheClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profil, api } = useSession();
  const { synchroniser, version } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const indicatif = profil?.commerce.indicatif;
  const [historique, setHistorique] = useState<Historique | null>(null);
  const [erreurHistorique, setErreurHistorique] = useState<string | null>(null);
  const [piece, setPiece] = useState<string | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (base) => ({
      client: await base.premier<ClientSync>('SELECT * FROM client WHERE id = ?', [id]),
      garant: await base.premier<GarantSync>('SELECT * FROM garant WHERE clientId = ?', [id]),
    }),
    [id],
  );

  // Relu après chaque synchronisation : un client créé hors ligne n'existe sur le
  // serveur qu'une fois son opération envoyée.
  useEffect(() => {
    let actif = true;
    api
      .requete<Historique>(`/clients/${id}/historique`)
      .then((h) => {
        if (!actif) return;
        setHistorique(h);
        setErreurHistorique(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setErreurHistorique(
          e instanceof ErreurApi && e.statut === 404
            ? 'disponible après la synchronisation de ce client.'
            : messageErreur(e),
        );
      });
    return () => {
      actif = false;
    };
  }, [api, id, version]);

  if (!donnees)
    return (
      <Ecran titre="Client" enHaut>
        {null}
      </Ecran>
    );
  const { client, garant } = donnees;
  if (!client) {
    return (
      <Ecran titre="Client" enHaut>
        <Message texte="Client introuvable." />
        <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      </Ecran>
    );
  }

  const voirPiece = async () => {
    setMessage(null);
    try {
      setPiece(await lireImagePrivee(api, `/clients/${client.id}/piece`));
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const photographierPiece = async (source: 'galerie' | 'camera') => {
    setMessage(null);
    try {
      const uri = await choisirPhoto(source);
      if (!uri) return;
      setEnvoi(true);
      await envoyerImage(api, `/clients/${client.id}/piece`, uri);
      setPiece(null);
      synchroniser();
      setMessage({ texte: 'Photo de la pièce enregistrée.', type: 'info' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Ecran
      titre={client.nom}
      sousTitre={client.type === 'GROSSISTE' ? 'Client grossiste' : 'Client de détail'}
      enHaut
    >
      <Carte>
        <Texte gras>{formaterTelephone(client.telephone, indicatif)}</Texte>
        {client.adresse ? <Texte discret>{client.adresse}</Texte> : null}
        <Texte discret>
          Plafond de crédit :{' '}
          {client.plafondCredit === null
            ? 'pas de crédit autorisé'
            : formaterMontant(client.plafondCredit, monnaie)}
        </Texte>
        {client.archive ? <Texte discret>Archivé</Texte> : null}
      </Carte>
      <Bouton
        titre="Modifier la fiche"
        onPress={() => router.push({ pathname: '/client/edition', params: { id: client.id } })}
      />

      <Message texte={message?.texte ?? null} type={message?.type} />

      <Carte>
        <Texte gras>Pièce d’identité</Texte>
        <Texte discret>
          {client.typePiece
            ? `${LIBELLES_PIECES[client.typePiece]}${client.numeroPiece ? ` n° ${client.numeroPiece}` : ''}`
            : 'Non renseignée'}
        </Texte>
        {piece ? (
          <Image
            source={{ uri: piece }}
            style={styles.piece}
            contentFit="contain"
            cachePolicy="none"
            accessibilityLabel="Photo de la pièce d’identité"
          />
        ) : null}
        <View style={styles.actions}>
          {client.photoPiece && !piece ? (
            <View style={styles.action}>
              <Bouton
                titre="Voir la photo"
                variante="secondaire"
                onPress={() => void voirPiece()}
              />
            </View>
          ) : null}
          {piece ? (
            <View style={styles.action}>
              <Bouton titre="Masquer" variante="secondaire" onPress={() => setPiece(null)} />
            </View>
          ) : null}
          {Platform.OS !== 'web' ? (
            <View style={styles.action}>
              <Bouton
                titre="Photographier la pièce"
                variante="secondaire"
                chargement={envoi}
                onPress={() => void photographierPiece('camera')}
              />
            </View>
          ) : null}
          <View style={styles.action}>
            <Bouton
              titre={client.photoPiece ? 'Remplacer la photo' : 'Ajouter une photo'}
              variante="secondaire"
              chargement={envoi}
              onPress={() => void photographierPiece('galerie')}
            />
          </View>
        </View>
        <Texte discret>
          Visible par le personnel connecté seulement ; chaque consultation est enregistrée.
        </Texte>
      </Carte>

      <Carte>
        <Texte gras>Garant</Texte>
        {garant ? (
          <>
            <Texte>
              {garant.nom}
              {garant.lien ? ` (${garant.lien})` : ''}
            </Texte>
            <Texte discret>{formaterTelephone(garant.telephone, indicatif)}</Texte>
            {garant.typePiece ? (
              <Texte discret>
                {LIBELLES_PIECES[garant.typePiece]}
                {garant.numeroPiece ? ` n° ${garant.numeroPiece}` : ''}
              </Texte>
            ) : null}
          </>
        ) : (
          <Texte discret>Aucun garant.</Texte>
        )}
      </Carte>

      <Carte>
        <Texte gras>Historique</Texte>
        {erreurHistorique ? <Texte discret>Disponible en ligne : {erreurHistorique}</Texte> : null}
        {historique ? (
          historique.ventes.length + historique.credits.length + historique.trocs.length === 0 ? (
            <Texte discret>Aucun achat, crédit ou troc pour l’instant.</Texte>
          ) : (
            <>
              {historique.ventes.map((v) => (
                <Texte key={v.id} discret>
                  {date(v.date)} · Facture {v.numero} · {formaterMontant(v.total, monnaie)} ·{' '}
                  {v.boutique}
                </Texte>
              ))}
              {historique.credits.map((c) => (
                <Texte key={c.id} discret>
                  {date(c.date)} · Crédit de {formaterMontant(c.montantTotal, monnaie)}, reste{' '}
                  {formaterMontant(c.montantRestant, monnaie)}
                </Texte>
              ))}
              {historique.trocs.map((t) => (
                <Texte key={t.id} discret>
                  {date(t.date)} · Troc : {t.description} (
                  {formaterMontant(t.valeurRetenue, monnaie)})
                </Texte>
              ))}
            </>
          )
        ) : null}
      </Carte>
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  piece: { width: '100%', height: 220, borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: 150 },
});
