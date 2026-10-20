import { formaterMontant, peutGererSessions, type ProduitSync } from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface Fiche {
  produit: ProduitSync;
  prixDetail: number;
  prixGros: number;
  quantite: number;
  articles: { id: string; imei: string; statut: string }[];
}

/** Fiche produit de la boutique : prix, quantité, IMEI en stock ; ajustements par le gérant. */
export default function FicheProduit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const monnaie = profil?.commerce.monnaie;
  const [delta, setDelta] = useState('');
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);

  const fiche = useLecture<Fiche | null>(
    async (base) => {
      const produit = await base.premier<ProduitSync>('SELECT * FROM produit WHERE id = ?', [id]);
      if (!produit || !boutique) return null;
      const prix = await base.premier<{ prixDetail: number | null; prixGros: number | null }>(
        'SELECT prixDetail, prixGros FROM prixBoutique WHERE produitId = ? AND boutiqueId = ?',
        [id, boutique.id],
      );
      const stock = await base.premier<{ quantite: number }>(
        'SELECT quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
        [id, boutique.id],
      );
      const articles = await base.tous<Fiche['articles'][number]>(
        `SELECT id, imei, statut FROM article
          WHERE produitId = ? AND boutiqueId = ? AND statut IN ('EN_STOCK', 'A_REPARER')
          ORDER BY imei`,
        [id, boutique.id],
      );
      return {
        produit,
        prixDetail: prix?.prixDetail ?? produit.prixDetail,
        prixGros: prix?.prixGros ?? produit.prixGros,
        quantite: stock?.quantite ?? 0,
        articles,
      };
    },
    [id, boutique?.id],
  );

  if (!fiche || !boutique) {
    return (
      <Ecran titre="Produit" enHaut>
        <Texte discret>{fiche === null ? 'Produit introuvable.' : 'Chargement…'}</Texte>
        <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      </Ecran>
    );
  }
  const { produit } = fiche;

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

  return (
    <Ecran titre={produit.nom} sousTitre={boutique.nom} enHaut>
      <Carte>
        <Texte>Prix de détail : {formaterMontant(fiche.prixDetail, monnaie)}</Texte>
        <Texte>Prix de gros : {formaterMontant(fiche.prixGros, monnaie)}</Texte>
        {produit.prixAchat !== null ? (
          <Texte discret>Prix d’achat : {formaterMontant(produit.prixAchat, monnaie)}</Texte>
        ) : null}
        <Texte gras>En stock : {fiche.quantite}</Texte>
        {produit.garantieMois > 0 ? (
          <Texte discret>Garantie : {produit.garantieMois} mois</Texte>
        ) : null}
      </Carte>

      <Message texte={message?.texte ?? null} type={message?.type} />

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
              <Texte>IMEI {a.imei}</Texte>
              {a.statut === 'A_REPARER' ? <Texte discret>À réparer</Texte> : null}
              {gestion ? (
                <Bouton titre="Sortir du stock" variante="danger" onPress={() => void sortir(a)} />
              ) : null}
            </Carte>
          ))}
        </>
      ) : null}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
