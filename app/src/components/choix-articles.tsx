import { formaterMontant } from '@gestvente/commun';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { type Dispatch, type SetStateAction, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Message, styleSaisie, Texte } from '@/components/ui';
import {
  accessoiresCompatibles,
  type ArticleChoisi,
  articleEnStock,
  imeisDisponibles,
  produitPourVente,
  versPanier,
  telephonesSansImei,
} from '@/lib/caisse';
import {
  categoriesVente,
  type ProduitTrouve,
  rechercherProduits,
  trouverParCode,
} from '@/lib/catalogue';
import type { ArticlePanier, LignePrix } from '@/lib/panier';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

type Produit = NonNullable<Awaited<ReturnType<typeof produitPourVente>>>;

/** Produit choisi dans la liste, en attente de sa quantité (ou de son IMEI). */
interface Selection {
  produit: Produit;
  /** Téléphones vendables sans IMEI (hors panier). */
  sansImei: number;
}

const entierPositif = (texte: string) => {
  const propre = texte.replace(/\s/g, '');
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/** Rangée de boutons de catégorie qui défile horizontalement. */
function Categories({
  options,
  valeur,
  surChoix,
}: {
  options: { id: string; nom: string }[];
  valeur: string;
  surChoix: (id: string) => void;
}) {
  const c = useCouleurs();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Catégories"
      contentContainerStyle={styles.rangee}
    >
      {options.map((o) => {
        const actif = o.id === valeur;
        return (
          <Pressable
            key={o.id || 'toutes'}
            accessibilityRole="radio"
            accessibilityState={{ selected: actif }}
            onPress={() => surChoix(actif && o.id ? '' : o.id)}
            style={[
              styles.filtre,
              {
                backgroundColor: actif ? c.bouton : c.carte,
                borderColor: actif ? c.bouton : c.bordure,
              },
            ]}
          >
            <Text style={{ color: actif ? '#ffffff' : c.texte, fontWeight: actif ? '700' : '500' }}>
              {o.nom}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Choix des articles d'une vente ou d'un échange : une liste déroulante où l'on cherche
 * (nom, code-barres, IMEI) ou choisit, les produits de la catégorie touchée en tête ; la
 * quantité (ou l'IMEI) puis « Ajouter » ; le tableau des articles, où l'on modifie la
 * quantité ou retire une ligne. Lecteur de codes ou caméra : ajout direct.
 */
export function ChoixArticles({
  boutiqueId,
  monnaie,
  articles,
  setArticles,
  lignes,
  titre = 'Articles',
}: {
  boutiqueId: string;
  monnaie?: string;
  articles: ArticlePanier[];
  setArticles: Dispatch<SetStateAction<ArticlePanier[]>>;
  /** Articles avec leur prix (détail ou gros) calculé par le parent. */
  lignes: LignePrix[];
  titre?: string;
}) {
  const c = useCouleurs();
  const { base } = useSync();
  // Téléphone : le nom de l'article sur sa ligne, quantité et total en dessous.
  const etroit = useWindowDimensions().width < 560;
  const [recherche, setRecherche] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [actif, setActif] = useState(false);
  const [categorieId, setCategorieId] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [quantite, setQuantite] = useState('1');
  /** Quantités en cours de saisie dans le tableau (validées en quittant le champ). */
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [scanner, setScanner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const categories = useLecture((b) => categoriesVente(b), []);
  const resultats = useLecture(
    async (b) =>
      ouverte
        ? rechercherProduits(b, boutiqueId, recherche, {
            limite: 40,
            enStockDabord: true,
            categoriePrioritaire: categorieId || null,
          })
        : [],
    [ouverte, recherche, boutiqueId, categorieId],
  );
  const dejaChoisis = articles.flatMap((a) => (a.articleId ? [a.articleId] : []));
  const imeis = useLecture(
    async (b) =>
      selection?.produit.type === 'TELEPHONE'
        ? imeisDisponibles(b, boutiqueId, selection.produit.id, dejaChoisis)
        : [],
    [selection?.produit.id, dejaChoisis.join(','), boutiqueId],
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

  /** Quantité vendable d'un produit sans IMEI (accessoire, ou téléphone reçu sans IMEI). */
  const maximumSansImei = async (p: Produit) =>
    p.type === 'ACCESSOIRE' ? p.quantite : telephonesSansImei(base, boutiqueId, p.id);

  const quantiteAuPanier = (produitId: string) =>
    articles
      .filter((a) => a.produitId === produitId && !a.articleId)
      .reduce((t, a) => t + a.quantite, 0);

  /** Ajoute `n` unités sans IMEI (une seule ligne par produit), dans la limite du stock. */
  const ajouterQuantite = async (p: Produit, n: number) => {
    const reste = (await maximumSansImei(p)) - quantiteAuPanier(p.id);
    if (reste <= 0) {
      setMessage(
        p.type === 'TELEPHONE'
          ? `« ${p.nom} » : plus de téléphone sans IMEI ; choisissez-le par son IMEI.`
          : `« ${p.nom} » : plus rien en stock.`,
      );
      return false;
    }
    const ajout = Math.min(n, reste);
    if (ajout < n) setMessage(`« ${p.nom} » : ${reste} seulement en stock, ${ajout} ajouté(s).`);
    setArticles((as) => {
      const deja = as.find((a) => a.produitId === p.id && !a.articleId);
      if (deja)
        return as.map((a) => (a.cle === deja.cle ? { ...a, quantite: a.quantite + ajout } : a));
      return [...as, { ...versPanier(p, Crypto.randomUUID(), null), quantite: ajout }];
    });
    return true;
  };

  const ajouterImei = (p: Produit, article: ArticleChoisi) => {
    if (articles.some((a) => a.articleId === article.id)) return;
    setArticles((as) => [...as, versPanier(p, Crypto.randomUUID(), article)]);
  };

  /** Produit choisi dans la liste : on attend sa quantité, ou son IMEI pour un téléphone. */
  const choisir = async (produitId: string) => {
    setMessage(null);
    const p = await produitPourVente(base, boutiqueId, produitId);
    if (!p) return;
    setOuverte(false);
    setRecherche('');
    setQuantite('1');
    if (p.type === 'TELEPHONE') {
      const sansImei = (await telephonesSansImei(base, boutiqueId, p.id)) - quantiteAuPanier(p.id);
      const avecImei = (await imeisDisponibles(base, boutiqueId, p.id, dejaChoisis)).length;
      if (sansImei <= 0 && avecImei === 0) {
        setSelection(null);
        setMessage(`« ${p.nom} » : plus de téléphone en stock.`);
        return;
      }
      setSelection({ produit: p, sansImei: Math.max(0, sansImei) });
      return;
    }
    if (p.quantite - quantiteAuPanier(p.id) <= 0) {
      setSelection(null);
      setMessage(`« ${p.nom} » : plus rien en stock.`);
      return;
    }
    setSelection({ produit: p, sansImei: 0 });
  };

  const validerSelection = async () => {
    if (!selection) return;
    const n = entierPositif(quantite);
    if (!Number.isInteger(n) || n < 1) return setMessage('Quantité : nombre entier attendu.');
    setMessage(null);
    if (await ajouterQuantite(selection.produit, n)) setSelection(null);
  };

  /** Lecteur USB (code puis Entrée) ou caméra : code-barres ou IMEI exact, ajout direct. */
  const lireCode = async (code: string) => {
    const trouve = await trouverParCode(base, boutiqueId, code);
    if (!trouve) {
      setRecherche(code);
      setOuverte(true);
      return;
    }
    setMessage(null);
    setRecherche('');
    setOuverte(false);
    const p = await produitPourVente(base, boutiqueId, trouve.produitId);
    if (!p) return;
    if (trouve.articleId) {
      const article = await articleEnStock(base, boutiqueId, trouve.articleId);
      if (!article) {
        setMessage(`Le téléphone ${code} n’est pas en stock dans cette boutique.`);
        return;
      }
      ajouterImei(p, article);
      return;
    }
    if (p.type === 'TELEPHONE') {
      await choisir(p.id);
      return;
    }
    await ajouterQuantite(p, 1);
  };

  const retirer = (cle: string) => setArticles((as) => as.filter((a) => a.cle !== cle));

  const oublierSaisie = (cle: string) =>
    setSaisies((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== cle)));

  /** Nouvelle quantité d'une ligne du tableau (0 : la ligne est retirée). */
  const changerQuantite = async (cle: string, voulue: number) => {
    oublierSaisie(cle);
    const ligne = articles.find((a) => a.cle === cle);
    if (!ligne) return;
    if (voulue <= 0) return retirer(cle);
    let nouvelle = voulue;
    if (voulue > ligne.quantite) {
      const p = await produitPourVente(base, boutiqueId, ligne.produitId);
      if (!p) return;
      const maximum = await maximumSansImei(p);
      if (voulue > maximum) {
        setMessage(`« ${p.nom} » : ${maximum} en stock.`);
        nouvelle = Math.max(1, maximum);
      } else setMessage(null);
    } else setMessage(null);
    setArticles((as) => as.map((a) => (a.cle === cle ? { ...a, quantite: nouvelle } : a)));
  };

  const validerSaisie = (cle: string) => {
    const texte = saisies[cle];
    if (texte === undefined) return;
    const n = entierPositif(texte);
    if (Number.isNaN(n)) {
      oublierSaisie(cle);
      setMessage('Quantité : nombre entier attendu.');
      return;
    }
    void changerQuantite(cle, n);
  };

  const prioritaires = categorieId
    ? (resultats ?? []).filter((p) => p.categorieId === categorieId).length
    : 0;
  const nomCategorie = categories?.find((k) => k.id === categorieId)?.nom;
  const nombre = lignes.reduce((t, l) => t + l.quantite, 0);
  const total = lignes.reduce((t, l) => t + l.total, 0);

  const option = (p: ProduitTrouve, i: number) => (
    <Pressable
      key={p.id}
      accessibilityRole="menuitem"
      onPress={() => void choisir(p.id)}
      style={({ pressed }) => [
        styles.option,
        {
          backgroundColor: pressed ? c.fondPrimaire : 'transparent',
          borderBottomColor: c.bordure,
          // Trait entre les produits de la catégorie choisie et les autres.
          borderTopColor: c.bordureSaisie,
          borderTopWidth: categorieId && i === prioritaires && i > 0 ? 2 : 0,
        },
      ]}
    >
      <Text style={{ color: c.texte, flex: 1, fontWeight: '600' }} numberOfLines={2}>
        {p.nom}
      </Text>
      <Text style={{ color: c.texte }}>{formaterMontant(p.prixDetail, monnaie)}</Text>
      <View
        style={[styles.stock, { backgroundColor: p.quantite > 0 ? c.fondSucces : c.fondDanger }]}
      >
        <Text
          style={{ color: p.quantite > 0 ? c.succes : c.danger, fontWeight: '700', fontSize: 12 }}
        >
          {p.quantite > 0 ? `${p.quantite} en stock` : 'Rupture'}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.carte, { backgroundColor: c.carte, borderColor: c.bordure }]}>
      <Texte gras>{titre}</Texte>
      {categories?.length ? (
        <Categories
          options={[{ id: '', nom: 'Toutes' }, ...categories]}
          valeur={categorieId}
          surChoix={(id) => {
            setCategorieId(id);
            // Une catégorie touchée déroule la liste, ses produits en tête.
            setOuverte(true);
          }}
        />
      ) : null}

      <View style={styles.combo}>
        <View style={{ flex: 1 }}>
          <TextInput
            value={recherche}
            onChangeText={(t) => {
              setRecherche(t);
              setOuverte(true);
            }}
            onFocus={() => {
              setActif(true);
              setOuverte(true);
            }}
            onBlur={() => setActif(false)}
            onSubmitEditing={() => void lireCode(recherche)}
            autoCorrect={false}
            returnKeyType="search"
            placeholder={
              etroit
                ? 'Chercher ou choisir un article'
                : 'Chercher ou choisir un article (nom, code-barres, IMEI)'
            }
            placeholderTextColor={c.texteDiscret}
            accessibilityLabel="Article : chercher ou choisir"
            style={[styleSaisie(c, actif), styles.saisieCombo]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              ouverte ? 'Fermer la liste des articles' : 'Dérouler la liste des articles'
            }
            accessibilityState={{ expanded: ouverte }}
            hitSlop={8}
            onPress={() => setOuverte((o) => !o)}
            style={styles.chevron}
          >
            <Ionicons
              name={ouverte ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={c.texteDiscret}
            />
          </Pressable>
        </View>
        {scannerDisponible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scanner un code-barres ou un IMEI"
            onPress={() => setScanner(true)}
            style={[styles.scanner, { borderColor: c.bordureSaisie, backgroundColor: c.saisie }]}
          >
            <Ionicons name="barcode-outline" size={24} color={c.primaire} />
          </Pressable>
        ) : null}
      </View>

      {ouverte ? (
        <View
          accessibilityRole="menu"
          style={[styles.liste, { borderColor: c.bordureSaisie, backgroundColor: c.carte }]}
        >
          {nomCategorie && prioritaires > 0 ? (
            <Text style={[styles.entete, { color: c.texteDiscret }]}>
              « {nomCategorie} » en tête de liste
            </Text>
          ) : null}
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={styles.defilement}
          >
            {resultats?.length === 0 ? (
              <Text style={[styles.vide, { color: c.texteDiscret }]}>
                Aucun article ne correspond.
              </Text>
            ) : null}
            {resultats?.map(option)}
          </ScrollView>
        </View>
      ) : null}

      {selection ? (
        <View
          style={[styles.selection, { borderColor: c.primaire, backgroundColor: c.fondPrimaire }]}
        >
          <View style={styles.ligneSelection}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.texte, fontWeight: '700' }}>{selection.produit.nom}</Text>
              <Text style={{ color: c.texteDiscret }}>
                {formaterMontant(selection.produit.prixDetail, monnaie)} l’unité
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Annuler le choix"
              hitSlop={8}
              onPress={() => setSelection(null)}
            >
              <Ionicons name="close" size={22} color={c.texteDiscret} />
            </Pressable>
          </View>
          {selection.produit.type === 'TELEPHONE' && imeis?.length ? (
            <>
              <Texte discret>Touchez l’IMEI du téléphone vendu :</Texte>
              <View style={styles.pastilles}>
                {imeis.map((a) => (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    onPress={() => {
                      ajouterImei(selection.produit, a);
                      if (selection.sansImei <= 0 && imeis.length <= 1) setSelection(null);
                    }}
                    style={[styles.pastille, { borderColor: c.primaire, backgroundColor: c.carte }]}
                  >
                    <Text style={{ color: c.primaire }}>
                      {a.imei}
                      {a.prixRevente !== null
                        ? ` · occasion ${formaterMontant(a.prixRevente, monnaie)}`
                        : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {selection.produit.type === 'ACCESSOIRE' || selection.sansImei > 0 ? (
            <View style={styles.ligneSelection}>
              <Text style={{ color: c.texte }}>
                {selection.produit.type === 'TELEPHONE' ? 'Sans IMEI, quantité' : 'Quantité'}
              </Text>
              <TextInput
                value={quantite}
                onChangeText={setQuantite}
                autoFocus
                keyboardType="number-pad"
                selectTextOnFocus
                onSubmitEditing={() => void validerSelection()}
                accessibilityLabel={`Quantité de ${selection.produit.nom}`}
                style={[styleSaisie(c), styles.quantiteSelection]}
              />
              <View style={styles.boutonAjouter}>
                <Bouton
                  titre="Ajouter au tableau"
                  icone="add-circle"
                  onPress={() => void validerSelection()}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      <Message texte={message} />

      <View style={[styles.tableau, { borderColor: c.bordure }]}>
        <View style={[styles.rang, styles.rangEntete, { backgroundColor: c.fondPrimaire }]}>
          <Text style={[styles.colArticle, styles.titreCol, { color: c.texte }]}>
            {etroit ? 'Article · quantité · total' : 'Article'}
          </Text>
          {etroit ? null : (
            <>
              <Text style={[styles.colQte, styles.titreCol, { color: c.texte }]}>Qté</Text>
              <Text style={[styles.colTotal, styles.titreCol, { color: c.texte }]}>Total</Text>
              <View style={styles.colRetirer} />
            </>
          )}
        </View>
        {lignes.length === 0 ? (
          <Text style={[styles.vide, { color: c.texteDiscret }]}>
            Choisissez un article dans la liste ou scannez-le.
          </Text>
        ) : null}
        {lignes.map((l) => {
          const modifiable = l.type === 'ACCESSOIRE' || !l.articleId;
          return (
            <View
              key={l.cle}
              style={[styles.rang, etroit && styles.rangEtroit, { borderTopColor: c.bordure }]}
            >
              <View style={[styles.colArticle, etroit && styles.pleineLargeur]}>
                <Text style={{ color: c.texte, fontWeight: '600' }}>
                  {l.nom}
                  {l.occasion ? ' (occasion)' : ''}
                </Text>
                <Text style={{ color: c.texteDiscret, fontSize: 13 }}>
                  {l.imei ? `IMEI ${l.imei} · ` : ''}
                  {formaterMontant(l.prixUnitaire, monnaie)}
                  {l.tarif === 'GROS' ? ' (gros)' : ''}
                </Text>
              </View>
              <View style={[styles.colQte, styles.quantite]}>
                {modifiable ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Un ${l.nom} de moins`}
                      hitSlop={6}
                      onPress={() => void changerQuantite(l.cle, l.quantite - 1)}
                    >
                      <Text style={[styles.plusMoins, { color: c.primaire }]}>−</Text>
                    </Pressable>
                    <TextInput
                      value={saisies[l.cle] ?? String(l.quantite)}
                      onChangeText={(t) => setSaisies((s) => ({ ...s, [l.cle]: t }))}
                      onBlur={() => validerSaisie(l.cle)}
                      onSubmitEditing={() => validerSaisie(l.cle)}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      accessibilityLabel={`Quantité de ${l.nom}`}
                      style={[
                        styles.saisieQte,
                        { color: c.texte, borderColor: c.bordureSaisie, backgroundColor: c.saisie },
                      ]}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Un ${l.nom} de plus`}
                      hitSlop={6}
                      onPress={() => void changerQuantite(l.cle, l.quantite + 1)}
                    >
                      <Text style={[styles.plusMoins, { color: c.primaire }]}>+</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={{ color: c.texte, fontWeight: '700' }}>1</Text>
                )}
              </View>
              <Text
                style={[
                  styles.colTotal,
                  etroit && styles.souple,
                  { color: c.texte, fontWeight: '700' },
                ]}
              >
                {formaterMontant(l.total, monnaie)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${l.nom}`}
                hitSlop={6}
                onPress={() => retirer(l.cle)}
                style={styles.colRetirer}
              >
                <Ionicons name="trash-outline" size={20} color={c.danger} />
              </Pressable>
            </View>
          );
        })}
        {lignes.length ? (
          <View style={[styles.rang, { borderTopColor: c.bordure }]}>
            <Text style={[styles.colArticle, { color: c.texteDiscret }]}>
              {nombre} article{nombre > 1 ? 's' : ''}
            </Text>
            <Text
              style={[
                styles.colTotal,
                etroit ? styles.souple : styles.totalGeneral,
                { color: c.texte, fontWeight: '800' },
              ]}
            >
              {formaterMontant(total, monnaie)}
            </Text>
            <View style={styles.colRetirer} />
          </View>
        ) : null}
      </View>

      {suggestions?.length ? (
        <>
          <Texte discret>Accessoires compatibles :</Texte>
          <View style={styles.pastilles}>
            {suggestions.map((s) => (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                onPress={() => void choisir(s.id)}
                style={[styles.pastille, { borderColor: c.primaire }]}
              >
                <Text style={{ color: c.primaire }}>
                  + {s.nom} ({formaterMontant(s.prixDetail, monnaie)})
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <Scanner
        visible={scanner}
        surCode={(code) => void lireCode(code)}
        fermer={() => setScanner(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  carte: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  rangee: { gap: 8, paddingVertical: 2 },
  filtre: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7 },
  combo: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  saisieCombo: { paddingRight: 44 },
  chevron: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  scanner: {
    borderWidth: 1.5,
    borderRadius: 10,
    width: 50,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liste: { borderWidth: 1.5, borderRadius: 10, overflow: 'hidden' },
  defilement: { maxHeight: 320 },
  entete: { fontSize: 12, fontWeight: '700', paddingHorizontal: 12, paddingTop: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stock: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  vide: { padding: 12, textAlign: 'center' },
  selection: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 8 },
  ligneSelection: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  quantiteSelection: { width: 80, textAlign: 'center' },
  boutonAjouter: { flex: 1, minWidth: 150 },
  pastilles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pastille: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  tableau: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  rang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rangEntete: { borderTopWidth: 0, paddingVertical: 6 },
  titreCol: { fontWeight: '700', fontSize: 13 },
  colArticle: { flex: 1, minWidth: 80 },
  colQte: { width: 112, justifyContent: 'center', textAlign: 'center' },
  colTotal: { width: 96, textAlign: 'right' },
  colRetirer: { width: 26, alignItems: 'center' },
  rangEtroit: { flexWrap: 'wrap', rowGap: 4 },
  pleineLargeur: { flexBasis: '100%' },
  souple: { flex: 1, width: 'auto' },
  totalGeneral: { width: 214 },
  quantite: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  plusMoins: { fontSize: 22, fontWeight: '700', paddingHorizontal: 4 },
  saisieQte: {
    borderWidth: 1,
    borderRadius: 6,
    width: 46,
    paddingVertical: 4,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
  },
});
