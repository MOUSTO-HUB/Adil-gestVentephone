import {
  type EtatReprise,
  formaterMontant,
  formaterDate,
  LIBELLES_ETATS_REPRISE,
  peutGererSessions,
  PHOTOS_TROC_MAX,
  type StatutArticle,
} from '@gestvente/commun';
import { useState } from 'react';
import { Image, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { choisirPhoto, envoyerImage, lireImagePrivee } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';
import { montantSaisi } from '@/lib/troc';

interface LigneTroc {
  id: string;
  creeLe: string;
  imei: string;
  etatGlobal: EtatReprise;
  note: string;
  valeurProposee: number;
  valeurRetenue: number;
  photos: number;
  articleId: string | null;
  client: string | null;
  produit: string | null;
  statut: StatutArticle | null;
  prixRevente: number | null;
}

const LIBELLES_STATUTS: Partial<Record<StatutArticle, string>> = {
  A_REPARER: 'À réparer',
  EN_STOCK: 'En vente (occasion)',
  VENDU: 'Revendu',
  REBUT: 'Au rebut',
  EN_TRANSFERT: 'En transfert',
};

/**
 * Trocs récents de la boutique : appareil repris, client, état, valeur, photos.
 * Les appareils à réparer sont remis en vente ici par le gérant (prix d'occasion).
 */
export default function Trocs() {
  const c = useCouleurs();
  const { profil, boutique, api } = useSession();
  const { enregistrer, synchroniser } = useSync();
  const [filtre, setFiltre] = useState<'TOUS' | 'A_REPARER'>('TOUS');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const [prix, setPrix] = useState<Record<string, string>>({});
  const [apercu, setApercu] = useState<{ id: string; images: string[] } | null>(null);
  const boutiqueId = boutique?.id ?? '';
  const gestion = !!profil && peutGererSessions(profil.role);

  const trocs = useLecture(
    (b) =>
      b.tous<LigneTroc>(
        `SELECT t.id, t.creeLe, t.imei, t.etatGlobal, t.note, t.valeurProposee, t.valeurRetenue,
                t.photos, t.articleId, c.nom AS client, p.nom AS produit, a.statut, a.prixRevente
           FROM troc t
           LEFT JOIN client c ON c.id = t.clientId
           LEFT JOIN article a ON a.id = t.articleId
           LEFT JOIN produit p ON p.id = a.produitId
          WHERE t.boutiqueId = ? ${filtre === 'A_REPARER' ? "AND a.statut = 'A_REPARER'" : ''}
          ORDER BY t.creeLe DESC
          LIMIT 200`,
        [boutiqueId],
      ),
    [boutiqueId, filtre],
  );

  if (!profil || !boutique)
    return (
      <Ecran titre="Trocs" enHaut>
        {null}
      </Ecran>
    );
  const monnaie = profil.commerce.monnaie;
  const fuseau = profil.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;

  const remettreEnVente = async (t: LigneTroc) => {
    setMessage(null);
    const montant = montantSaisi(prix[t.id] ?? '');
    if (!t.articleId || Number.isNaN(montant) || montant <= 0) {
      return setMessage({ texte: 'Indiquez le prix de revente.', type: 'erreur' });
    }
    try {
      await enregistrer({
        type: 'ARTICLE_REMETTRE_EN_VENTE',
        boutiqueId,
        contenu: { articleId: t.articleId, prixRevente: montant },
      });
      setMessage({ texte: `${t.produit ?? 'Téléphone'} remis en vente.`, type: 'info' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const ajouterPhoto = async (t: LigneTroc) => {
    setMessage(null);
    try {
      const uri = await choisirPhoto(Platform.OS === 'web' ? 'galerie' : 'camera');
      if (!uri) return;
      await envoyerImage(api, `/trocs/${t.id}/photos`, uri, 'POST');
      setMessage({ texte: 'Photo enregistrée.', type: 'info' });
      synchroniser();
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const voirPhotos = async (t: LigneTroc) => {
    setMessage(null);
    try {
      const images: string[] = [];
      for (let n = 1; n <= t.photos; n++) {
        images.push(await lireImagePrivee(api, `/trocs/${t.id}/photos/${n}`));
      }
      setApercu({ id: t.id, images });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  return (
    <Ecran titre="Trocs" sousTitre={boutique.nom} enHaut>
      <Choix
        libelle="Afficher"
        options={[
          { id: 'TOUS', nom: 'Tous les trocs' },
          { id: 'A_REPARER', nom: 'À réparer' },
        ]}
        valeurs={[filtre]}
        surChoix={([v]) => v && setFiltre(v as 'TOUS' | 'A_REPARER')}
      />
      <Message texte={message?.texte ?? null} type={message?.type} />
      {trocs?.length === 0 ? (
        <Texte discret>
          Aucun troc{filtre === 'A_REPARER' ? ' à réparer' : ''}. Un troc se fait depuis l’écran de
          vente.
        </Texte>
      ) : null}
      {trocs?.map((t) => (
        <Carte key={t.id} titre={t.produit ?? 'Téléphone repris'} icone="swap-horizontal">
          <Texte discret>
            {formaterDate(t.creeLe, fuseau)} · {t.client ?? 'Client'} · IMEI {t.imei}
          </Texte>
          <Texte>
            État {LIBELLES_ETATS_REPRISE[t.etatGlobal].toLowerCase()} · repris{' '}
            {formaterMontant(t.valeurRetenue, monnaie)}
            {t.valeurRetenue !== t.valeurProposee
              ? ` (proposé ${formaterMontant(t.valeurProposee, monnaie)})`
              : ''}
          </Texte>
          {t.note ? <Texte discret>{t.note}</Texte> : null}
          {t.statut ? (
            <Texte gras>
              {LIBELLES_STATUTS[t.statut] ?? t.statut}
              {t.statut === 'EN_STOCK' && t.prixRevente
                ? ` à ${formaterMontant(t.prixRevente, monnaie)}`
                : ''}
            </Texte>
          ) : null}
          {gestion && t.statut === 'A_REPARER' ? (
            <View style={styles.ligne}>
              <TextInput
                value={prix[t.id] ?? ''}
                onChangeText={(texte) => setPrix((p) => ({ ...p, [t.id]: texte }))}
                placeholder="Prix de revente"
                placeholderTextColor={c.texteDiscret}
                keyboardType="number-pad"
                accessibilityLabel="Prix de revente après réparation"
                style={[
                  styles.saisie,
                  { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
                ]}
              />
              <Bouton
                titre="Remettre en vente"
                icone="pricetag-outline"
                onPress={() => void remettreEnVente(t)}
              />
            </View>
          ) : null}
          <View style={styles.ligne}>
            {t.photos > 0 ? (
              <Bouton
                titre={`Voir les photos (${t.photos})`}
                icone="images-outline"
                variante="secondaire"
                onPress={() => void voirPhotos(t)}
              />
            ) : (
              <Texte discret>Aucune photo.</Texte>
            )}
            {t.photos < PHOTOS_TROC_MAX ? (
              <Bouton
                titre="Ajouter une photo"
                icone="camera-outline"
                variante="secondaire"
                onPress={() => void ajouterPhoto(t)}
              />
            ) : null}
          </View>
          {apercu?.id === t.id ? (
            <View style={styles.ligne}>
              {apercu.images.map((image, i) => (
                <Image
                  key={i}
                  source={{ uri: image }}
                  style={styles.photo}
                  accessibilityLabel={`Photo ${i + 1} de l’appareil repris`}
                />
              ))}
              <Bouton titre="Fermer" variante="secondaire" onPress={() => setApercu(null)} />
            </View>
          ) : null}
        </Carte>
      ))}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  saisie: {
    flex: 1,
    minWidth: 140,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  photo: { width: 160, height: 160, borderRadius: 8 },
});
