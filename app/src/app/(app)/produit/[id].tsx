import {
  formaterMontant,
  peutGererSessions,
  type PrixBoutiqueSync,
  prixApplicables,
  type ProduitSync,
} from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { PhotoProduit } from '@/components/photo-produit';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import { choisirPhoto, envoyerPhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface Fiche {
  produit: ProduitSync;
  prixBoutique: PrixBoutiqueSync | null;
  categorie: string | null;
  quantite: number;
  seuilMinimum: number;
  articles: { id: string; imei: string; statut: string }[];
  /** Accessoire : modèles compatibles ; téléphone : accessoires compatibles avec son modèle. */
  compatibles: { id: string; nom: string }[];
}

type MessageFiche = { texte: string; type: 'erreur' | 'info' } | null;

/** Fiche produit de la boutique : prix, quantité, IMEI en stock ; gestion par le gérant. */
export default function FicheProduit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profil, boutique, api } = useSession();
  const { enregistrer, synchroniser } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const monnaie = profil?.commerce.monnaie;
  const [delta, setDelta] = useState('');
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<MessageFiche>(null);
  const [envoiPhoto, setEnvoiPhoto] = useState(false);

  const fiche = useLecture<Fiche | null>(
    async (base) => {
      const produit = await base.premier<ProduitSync>('SELECT * FROM produit WHERE id = ?', [id]);
      if (!produit || !boutique) return null;
      const prixBoutique = await base.premier<PrixBoutiqueSync>(
        'SELECT * FROM prixBoutique WHERE produitId = ? AND boutiqueId = ?',
        [id, boutique.id],
      );
      const categorie = await base.premier<{ nom: string }>(
        'SELECT nom FROM categorie WHERE id = ?',
        [produit.categorieId],
      );
      const stock = await base.premier<{ quantite: number; seuilMinimum: number }>(
        'SELECT quantite, seuilMinimum FROM stock WHERE produitId = ? AND boutiqueId = ?',
        [id, boutique.id],
      );
      const articles = await base.tous<Fiche['articles'][number]>(
        `SELECT id, imei, statut FROM article
          WHERE produitId = ? AND boutiqueId = ? AND statut IN ('EN_STOCK', 'A_REPARER')
          ORDER BY imei`,
        [id, boutique.id],
      );
      const compatibles =
        produit.type === 'ACCESSOIRE'
          ? await base.tous<{ id: string; nom: string }>(
              `SELECT m.id, ma.nom || ' ' || m.nom AS nom FROM compatibilite c
                 JOIN modele m ON m.id = c.modeleId JOIN marque ma ON ma.id = m.marqueId
                WHERE c.accessoireId = ? ORDER BY nom`,
              [id],
            )
          : await base.tous<{ id: string; nom: string }>(
              `SELECT p.id, p.nom FROM compatibilite c JOIN produit p ON p.id = c.accessoireId
                WHERE c.modeleId = ? AND p.archive = 0 ORDER BY p.nom`,
              [produit.modeleId ?? ''],
            );
      return {
        produit,
        prixBoutique,
        categorie: categorie?.nom ?? null,
        quantite: stock?.quantite ?? 0,
        seuilMinimum: stock?.seuilMinimum ?? 0,
        articles,
        compatibles,
      };
    },
    [id, boutique?.id],
  );

  if (!fiche || !boutique) {
    return (
      <Ecran titre="Produit" enHaut>
        <Texte discret>{fiche === null ? 'Produit introuvable.' : 'Chargement…'}</Texte>
      </Ecran>
    );
  }
  const { produit } = fiche;
  const prix = prixApplicables(produit, fiche.prixBoutique);

  const executer = async (action: () => Promise<void>, succes: string) => {
    setMessage(null);
    try {
      await action();
      setMessage({ texte: succes, type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    }
  };

  const ajuster = () =>
    executer(async () => {
      const valeur = Number(delta.replace(',', '.'));
      if (!Number.isInteger(valeur) || valeur === 0) {
        throw new Error('Saisissez un nombre entier, positif ou négatif (ex. -2).');
      }
      await enregistrer({
        type: 'STOCK_AJUSTER',
        boutiqueId: boutique.id,
        contenu: { produitId: produit.id, delta: valeur, motif: motif.trim() },
      });
      setDelta('');
      setMotif('');
    }, 'Ajustement enregistré. Il sera envoyé au serveur dès que possible.');

  const sortir = async (article: { id: string; imei: string }) => {
    if (motif.trim().length < 3) {
      setMessage({
        texte: 'Indiquez d’abord le motif de la sortie (perte, casse, vol…).',
        type: 'erreur',
      });
      return;
    }
    if (!(await confirmer(`Sortir du stock le téléphone ${article.imei} ?`, 'Sortir'))) return;
    await executer(async () => {
      await enregistrer({
        type: 'ARTICLE_SORTIR',
        boutiqueId: boutique.id,
        contenu: { articleId: article.id, motif: motif.trim() },
      });
      setMotif('');
    }, `Téléphone ${article.imei} sorti du stock.`);
  };

  const changerPhoto = async (source: 'galerie' | 'camera') => {
    setMessage(null);
    try {
      const uri = await choisirPhoto(source);
      if (!uri) return;
      setEnvoiPhoto(true);
      await envoyerPhoto(api, produit.id, uri);
      synchroniser();
      setMessage({ texte: 'Photo enregistrée.', type: 'info' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoiPhoto(false);
    }
  };

  return (
    <Ecran
      titre={produit.nom}
      sousTitre={[fiche.categorie, boutique.nom].filter(Boolean).join(' · ')}
      enHaut
    >
      <View style={styles.entete}>
        <PhotoProduit photo={produit.photo} nom={produit.nom} taille={120} />
        <View style={styles.prix}>
          <Texte>Détail : {formaterMontant(prix.prixDetail, monnaie)}</Texte>
          <Texte>
            Gros : {formaterMontant(prix.prixGros, monnaie)}
            {produit.seuilGros ? ` (dès ${produit.seuilGros})` : ''}
          </Texte>
          {prix.prixAchat !== null ? (
            <Texte discret>Achat : {formaterMontant(prix.prixAchat, monnaie)}</Texte>
          ) : null}
          <Texte gras>En stock : {fiche.quantite}</Texte>
          {produit.garantieMois > 0 ? (
            <Texte discret>Garantie : {produit.garantieMois} mois</Texte>
          ) : null}
          {produit.codeBarres ? <Texte discret>Code-barres : {produit.codeBarres}</Texte> : null}
          {produit.etat === 'OCCASION' ? <Texte discret>Occasion</Texte> : null}
          {produit.archive ? <Texte discret>Archivé</Texte> : null}
        </View>
      </View>

      <Message texte={message?.texte ?? null} type={message?.type} />

      {gestion ? (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Bouton
              titre="Modifier la fiche"
              onPress={() =>
                router.push({ pathname: '/produit/edition', params: { id: produit.id } })
              }
            />
          </View>
          <View style={styles.action}>
            <Bouton
              titre={produit.photo ? 'Changer la photo' : 'Ajouter une photo'}
              variante="secondaire"
              chargement={envoiPhoto}
              onPress={() => void changerPhoto('galerie')}
            />
          </View>
          {Platform.OS !== 'web' ? (
            <View style={styles.action}>
              <Bouton
                titre="Photographier"
                variante="secondaire"
                chargement={envoiPhoto}
                onPress={() => void changerPhoto('camera')}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {fiche.compatibles.length ? (
        <Carte>
          <Texte gras>
            {produit.type === 'ACCESSOIRE' ? 'Compatible avec' : 'Accessoires compatibles'}
          </Texte>
          <Texte discret>{fiche.compatibles.map((c) => c.nom).join(', ')}</Texte>
        </Carte>
      ) : null}

      {gestion ? (
        <SeuilStock
          key={`seuil-${fiche.seuilMinimum}`}
          produitId={produit.id}
          boutiqueId={boutique.id}
          actuel={fiche.seuilMinimum}
          quantite={fiche.quantite}
          surMessage={setMessage}
        />
      ) : null}
      {gestion ? (
        <PrixDeLaBoutique
          key={JSON.stringify(fiche.prixBoutique)}
          produit={produit}
          actuels={fiche.prixBoutique}
          boutiqueId={boutique.id}
          boutiqueNom={boutique.nom}
          monnaie={monnaie}
          surMessage={setMessage}
        />
      ) : null}

      {gestion ? (
        <Champ
          libelle="Motif (obligatoire pour ajuster ou sortir)"
          value={motif}
          onChangeText={setMotif}
          placeholder="Recomptage, casse, perte…"
        />
      ) : null}

      {gestion && produit.type === 'ACCESSOIRE' ? (
        <>
          <Champ
            libelle="Ajuster la quantité (ex. -2 ou 5)"
            value={delta}
            onChangeText={setDelta}
            keyboardType="numbers-and-punctuation"
          />
          <Bouton titre="Enregistrer l’ajustement" onPress={() => void ajuster()} />
        </>
      ) : null}

      {produit.type === 'TELEPHONE' ? (
        <>
          <Texte gras>Téléphones en stock ({fiche.articles.length})</Texte>
          {fiche.articles.map((a) => (
            <Carte key={a.id}>
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push({ pathname: '/imei', params: { imei: a.imei } })}
              >
                <Texte>IMEI {a.imei} ›</Texte>
              </Pressable>
              {a.statut === 'A_REPARER' ? <Texte discret>À réparer</Texte> : null}
              {gestion ? (
                <Bouton titre="Sortir du stock" variante="danger" onPress={() => void sortir(a)} />
              ) : null}
            </Carte>
          ))}
        </>
      ) : null}
    </Ecran>
  );
}

const lire = (texte: string): number | null => {
  const propre = texte.replace(/[\s ]/g, '');
  if (!propre) return null;
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/** Seuil d'alerte : à ce niveau ou en dessous, le produit apparaît en « stock bas ». */
function SeuilStock({
  produitId,
  boutiqueId,
  actuel,
  quantite,
  surMessage,
}: {
  produitId: string;
  boutiqueId: string;
  actuel: number;
  quantite: number;
  surMessage: (m: MessageFiche) => void;
}) {
  const { enregistrer } = useSync();
  const [seuil, setSeuil] = useState(String(actuel));
  const enregistrerSeuil = async () => {
    const valeur = Number(seuil.trim());
    if (!Number.isInteger(valeur) || valeur < 0) {
      surMessage({ texte: 'Seuil : nombre entier positif ou zéro.', type: 'erreur' });
      return;
    }
    try {
      await enregistrer({
        type: 'STOCK_SEUIL',
        boutiqueId,
        contenu: { produitId, seuilMinimum: valeur },
      });
      surMessage({
        texte: valeur ? `Alerte à ${valeur} en stock.` : 'Alerte de stock désactivée.',
        type: 'info',
      });
    } catch (e) {
      surMessage({ texte: (e as Error).message, type: 'erreur' });
    }
  };
  return (
    <Carte>
      <Texte gras>Alerte de stock bas</Texte>
      <Texte discret>
        {actuel > 0
          ? `Alerte à ${actuel} ou moins${quantite <= actuel ? ' : stock bas en ce moment.' : '.'}`
          : 'Aucune alerte.'}
      </Texte>
      <Champ
        libelle="Seuil (0 : pas d’alerte)"
        value={seuil}
        onChangeText={setSeuil}
        keyboardType="number-pad"
      />
      <Bouton
        titre="Enregistrer le seuil"
        variante="secondaire"
        onPress={() => void enregistrerSeuil()}
      />
    </Carte>
  );
}

/** Prix propres à la boutique ; vides : les prix communs s'appliquent. */
function PrixDeLaBoutique({
  produit,
  actuels,
  boutiqueId,
  boutiqueNom,
  monnaie,
  surMessage,
}: {
  produit: ProduitSync;
  actuels: PrixBoutiqueSync | null;
  boutiqueId: string;
  boutiqueNom: string;
  monnaie?: string;
  surMessage: (m: MessageFiche) => void;
}) {
  const { enregistrer } = useSync();
  const texte = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  const [detail, setDetail] = useState(texte(actuels?.prixDetail));
  const [gros, setGros] = useState(texte(actuels?.prixGros));
  const [achat, setAchat] = useState(texte(actuels?.prixAchat));

  const envoyer = async (vider: boolean) => {
    const valeurs = vider
      ? { prixAchat: null, prixDetail: null, prixGros: null }
      : { prixAchat: lire(achat), prixDetail: lire(detail), prixGros: lire(gros) };
    if (Object.values(valeurs).some((v) => Number.isNaN(v))) {
      surMessage({ texte: 'Prix : nombres entiers attendus.', type: 'erreur' });
      return;
    }
    try {
      await enregistrer({
        type: 'PRIX_BOUTIQUE_ENREGISTRER',
        boutiqueId,
        contenu: { produitId: produit.id, ...valeurs },
      });
      surMessage({
        texte: vider ? 'Prix communs rétablis.' : 'Prix de la boutique enregistrés.',
        type: 'info',
      });
    } catch (e) {
      surMessage({ texte: (e as Error).message, type: 'erreur' });
    }
  };

  return (
    <Carte>
      <Texte gras>Prix propres à {boutiqueNom}</Texte>
      <Texte discret>
        Laissez vide pour appliquer le prix commun ({formaterMontant(produit.prixDetail, monnaie)}{' '}
        au détail).
      </Texte>
      <Champ libelle="Détail" value={detail} onChangeText={setDetail} keyboardType="number-pad" />
      <Champ libelle="Gros" value={gros} onChangeText={setGros} keyboardType="number-pad" />
      <Champ libelle="Achat" value={achat} onChangeText={setAchat} keyboardType="number-pad" />
      <Bouton
        titre="Enregistrer ces prix"
        variante="secondaire"
        onPress={() => void envoyer(false)}
      />
      {actuels ? (
        <Bouton
          titre="Revenir aux prix communs"
          variante="secondaire"
          onPress={() => void envoyer(true)}
        />
      ) : null}
    </Carte>
  );
}

const styles = StyleSheet.create({
  entete: { flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  prix: { flex: 1, minWidth: 180, gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: 160 },
});
