import { formaterMontant } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { useTheme } from 'expo-router';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Carte, Champ, Message, Texte } from '@/components/ui';
import {
  accessoiresCompatibles,
  type ArticleChoisi,
  articleEnStock,
  imeisDisponibles,
  produitPourVente,
  versPanier,
} from '@/lib/caisse';
import { rechercherProduits, trouverParCode } from '@/lib/catalogue';
import type { ArticlePanier, LignePrix } from '@/lib/panier';
import { useLecture, useSync } from '@/lib/sync/contexte';

/**
 * Choix des articles d'une vente ou d'un échange : recherche, lecteur de codes ou
 * caméra, choix de l'IMEI, quantités, accessoires compatibles proposés.
 */
export function ChoixArticles({
  boutiqueId,
  monnaie,
  articles,
  setArticles,
  lignes,
  titre = 'Panier',
}: {
  boutiqueId: string;
  monnaie?: string;
  articles: ArticlePanier[];
  setArticles: Dispatch<SetStateAction<ArticlePanier[]>>;
  /** Articles avec leur prix (détail ou gros) calculé par le parent. */
  lignes: LignePrix[];
  titre?: string;
}) {
  const { colors } = useTheme();
  const { base } = useSync();
  const [recherche, setRecherche] = useState('');
  const [choixImei, setChoixImei] = useState<{ produitId: string; nom: string } | null>(null);
  const [scanner, setScanner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const resultats = useLecture(
    async (b) =>
      recherche.trim() ? rechercherProduits(b, boutiqueId, recherche, { limite: 6 }) : [],
    [recherche, boutiqueId],
  );
  const imeis = useLecture(
    async (b) =>
      choixImei
        ? imeisDisponibles(
            b,
            boutiqueId,
            choixImei.produitId,
            articles.flatMap((a) => (a.articleId ? [a.articleId] : [])),
          )
        : [],
    [choixImei?.produitId, articles.length, boutiqueId],
  );
  const modeles = [...new Set(articles.flatMap((a) => (a.modeleId ? [a.modeleId] : [])))];
  const suggestions = useLecture(
    (b) =>
      accessoiresCompatibles(
        b,
        boutiqueId,
        modeles,
        articles.map((a) => a.produitId),
      ),
    [modeles.join(','), articles.length, boutiqueId],
  );

  if (!base) return null;

  const ajouterProduit = async (produitId: string, article: ArticleChoisi | null = null) => {
    setMessage(null);
    const produit = await produitPourVente(base, boutiqueId, produitId);
    if (!produit) return;
    setRecherche('');
    if (produit.type === 'TELEPHONE' && !article) {
      setChoixImei({ produitId: produit.id, nom: produit.nom });
      return;
    }
    setChoixImei(null);
    if (produit.type === 'ACCESSOIRE') {
      const deja = articles.find((a) => a.produitId === produit.id);
      if ((deja?.quantite ?? 0) + 1 > produit.quantite) {
        setMessage(`« ${produit.nom} » : ${produit.quantite} en stock.`);
        return;
      }
      if (deja) {
        setArticles((as) =>
          as.map((a) => (a.cle === deja.cle ? { ...a, quantite: a.quantite + 1 } : a)),
        );
        return;
      }
    }
    if (article && articles.some((a) => a.articleId === article.id)) return;
    setArticles((as) => [...as, versPanier(produit, Crypto.randomUUID(), article)]);
  };

  /** Lecteur USB (code puis Entrée) ou caméra : code-barres ou IMEI exact. */
  const lireCode = async (code: string) => {
    const trouve = await trouverParCode(base, boutiqueId, code);
    if (!trouve) {
      setRecherche(code);
      return;
    }
    if (trouve.articleId) {
      const article = await articleEnStock(base, boutiqueId, trouve.articleId);
      if (!article) {
        setMessage(`Le téléphone ${code} n’est pas en stock dans cette boutique.`);
        return;
      }
      await ajouterProduit(article.produitId, article);
    } else {
      await ajouterProduit(trouve.produitId);
    }
  };

  const changerQuantite = (cle: string, delta: number) =>
    setArticles((as) =>
      as.flatMap((a) =>
        a.cle !== cle
          ? [a]
          : a.quantite + delta <= 0
            ? []
            : [{ ...a, quantite: a.quantite + delta }],
      ),
    );

  return (
    <>
      <Champ
        libelle="Produit (nom, code-barres ou IMEI)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => void lireCode(recherche)}
      />
      {scannerDisponible ? (
        <Bouton titre="Scanner" variante="secondaire" onPress={() => setScanner(true)} />
      ) : null}
      {resultats?.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          onPress={() => void ajouterProduit(p.id)}
          style={[styles.resultat, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.text, flex: 1 }}>{p.nom}</Text>
          <Text style={{ color: colors.text, opacity: 0.65 }}>
            {formaterMontant(p.prixDetail, monnaie)} · {p.quantite} en stock
          </Text>
        </Pressable>
      ))}
      {choixImei ? (
        <Carte>
          <Texte gras>{choixImei.nom} : choisissez l’IMEI</Texte>
          {imeis?.length === 0 ? <Texte discret>Aucun téléphone disponible.</Texte> : null}
          <View style={styles.pastilles}>
            {imeis?.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                onPress={() => void ajouterProduit(choixImei.produitId, a)}
                style={[styles.pastille, { borderColor: colors.primary }]}
              >
                <Text style={{ color: colors.primary }}>
                  {a.imei}
                  {a.prixRevente !== null
                    ? ` · occasion ${formaterMontant(a.prixRevente, monnaie)}`
                    : ''}
                </Text>
              </Pressable>
            ))}
          </View>
          <Bouton titre="Fermer" variante="secondaire" onPress={() => setChoixImei(null)} />
        </Carte>
      ) : null}
      <Message texte={message} />

      <Carte>
        <Texte gras>{titre}</Texte>
        {lignes.length === 0 ? <Texte discret>Scannez ou cherchez un produit.</Texte> : null}
        {lignes.map((l) => (
          <View key={l.cle} style={styles.ligne}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {l.nom}
                {l.occasion ? ' (occasion)' : ''}
              </Text>
              <Text style={{ color: colors.text, opacity: 0.65 }}>
                {l.imei ? `IMEI ${l.imei} · ` : ''}
                {formaterMontant(l.prixUnitaire, monnaie)}
                {l.tarif === 'GROS' ? ' (gros)' : ''}
              </Text>
            </View>
            {l.type === 'ACCESSOIRE' ? (
              <View style={styles.quantite}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Un de moins"
                  onPress={() => changerQuantite(l.cle, -1)}
                >
                  <Text style={[styles.bouton, { color: colors.primary }]}>−</Text>
                </Pressable>
                <Text style={{ color: colors.text, fontWeight: '700' }}>{l.quantite}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Un de plus"
                  onPress={() => void ajouterProduit(l.produitId)}
                >
                  <Text style={[styles.bouton, { color: colors.primary }]}>+</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${l.nom}`}
                onPress={() => changerQuantite(l.cle, -1)}
              >
                <Text style={{ color: colors.notification, fontWeight: '700' }}>Retirer</Text>
              </Pressable>
            )}
            <Text
              style={{ color: colors.text, fontWeight: '700', minWidth: 90, textAlign: 'right' }}
            >
              {formaterMontant(l.total, monnaie)}
            </Text>
          </View>
        ))}
        {suggestions?.length ? (
          <>
            <Texte discret>Accessoires compatibles :</Texte>
            <View style={styles.pastilles}>
              {suggestions.map((s) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() => void ajouterProduit(s.id)}
                  style={[styles.pastille, { borderColor: colors.primary }]}
                >
                  <Text style={{ color: colors.primary }}>
                    + {s.nom} ({formaterMontant(s.prixDetail, monnaie)})
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </Carte>
      <Scanner
        visible={scanner}
        surCode={(code) => void lireCode(code)}
        fermer={() => setScanner(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  resultat: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pastille: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    paddingVertical: 4,
  },
  quantite: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bouton: { fontSize: 24, fontWeight: '700', paddingHorizontal: 6 },
});
