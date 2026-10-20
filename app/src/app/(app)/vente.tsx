import {
  type ClientSync,
  controlerPaiements,
  formaterMontant,
  LIBELLES_MOYENS,
  MOYENS_PAIEMENT,
  type MoyenPaiement,
  moyenAvecReference,
  plafondRemise,
  pourcentageRemise,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import {
  accessoiresCompatibles,
  articleEnStock,
  imeisDisponibles,
  produitPourVente,
  versPanier,
} from '@/lib/caisse';
import { rechercherProduits, trouverParCode } from '@/lib/catalogue';
import { rechercherClients } from '@/lib/clients';
import { type ArticlePanier, prixDuPanier, prochainNumeroFacture } from '@/lib/panier';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

type Paiements = Record<MoyenPaiement, { montant: string; reference: string }>;
const PAIEMENTS_VIDES = Object.fromEntries(
  MOYENS_PAIEMENT.map((m) => [m, { montant: '', reference: '' }]),
) as Paiements;

const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return propre === '' ? 0 : /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

interface Autorisation {
  jeton: string;
  gerant: string;
  plafond: number;
}

/**
 * Écran de vente : chercher ou scanner, panier, client facultatif, remise, paiement
 * (mixte possible). La vente s'enregistre sur l'appareil, même hors ligne.
 */
export default function Vente() {
  const { colors } = useTheme();
  const { profil, boutique, api } = useSession();
  const { base, enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const [articles, setArticles] = useState<ArticlePanier[]>([]);
  const [recherche, setRecherche] = useState('');
  const [choixImei, setChoixImei] = useState<{ produitId: string; nom: string } | null>(null);
  const [client, setClient] = useState<ClientSync | null>(null);
  const [rechercheClient, setRechercheClient] = useState('');
  const [remise, setRemise] = useState('');
  const [autorisation, setAutorisation] = useState<Autorisation | null>(null);
  const [gerantId, setGerantId] = useState('');
  const [gerantPin, setGerantPin] = useState('');
  const [paiements, setPaiements] = useState<Paiements>(PAIEMENTS_VIDES);
  const [scanner, setScanner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [derniere, setDerniere] = useState<{
    id: string;
    numero: string;
    total: number;
    rendu: number;
  } | null>(null);
  const boutiqueId = boutique?.id ?? '';

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
  const clients = useLecture(
    async (b) =>
      rechercheClient.trim() ? (await rechercherClients(b, rechercheClient)).slice(0, 5) : [],
    [rechercheClient],
  );

  if (!profil || !boutique || !base)
    return (
      <Ecran titre="Vente" enHaut>
        {null}
      </Ecran>
    );

  const montantRemise = entier(remise);
  const calcul = prixDuPanier(
    articles,
    client?.type === 'GROSSISTE',
    Number.isNaN(montantRemise) ? 0 : montantRemise,
  );
  const plafond = plafondRemise(profil.role, profil.commerce);
  const pourcentage = pourcentageRemise(calcul.remise, calcul.sousTotal);
  const autorisationNecessaire =
    pourcentage > plafond && (!autorisation || pourcentage > autorisation.plafond);
  const listePaiements = MOYENS_PAIEMENT.flatMap((moyen) => {
    const montant = entier(paiements[moyen].montant);
    return montant > 0
      ? [{ moyen, montant, reference: paiements[moyen].reference.trim() || null }]
      : [];
  });
  const paye = listePaiements.reduce((t, p) => t + p.montant, 0);

  const ajouterProduit = async (
    produitId: string,
    article: { id: string; imei: string } | null = null,
  ) => {
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

  const demanderAutorisation = async () => {
    setMessage(null);
    try {
      const reponse = await api.requete<Autorisation>('/ventes/autorisations-remise', {
        methode: 'POST',
        corps: { boutiqueId, identifiant: gerantId, pin: gerantPin, pourcentage },
      });
      setAutorisation(reponse);
      setGerantPin('');
    } catch (e) {
      setMessage(messageErreur(e));
    }
  };

  const encaisser = async () => {
    setMessage(null);
    if (!articles.length) return setMessage('Le panier est vide.');
    if (Number.isNaN(montantRemise)) return setMessage('Remise : nombre entier attendu.');
    if (calcul.remise > calcul.sousTotal)
      return setMessage('La remise dépasse le montant de la vente.');
    if (autorisationNecessaire) {
      return setMessage(
        `Remise de ${pourcentage} % : au-delà de ${plafond} %, un gérant doit la valider.`,
      );
    }
    if (listePaiements.some((p) => Number.isNaN(p.montant)))
      return setMessage('Montants : nombres entiers attendus.');
    const controle = controlerPaiements(calcul.total, listePaiements);
    if (!controle.ok) return setMessage(controle.motif);
    setEnvoi(true);
    try {
      const numero = await prochainNumeroFacture(base, boutique.prefixe, profil.appareilId);
      const venteId = Crypto.randomUUID();
      await enregistrer({
        type: 'VENTE_ENREGISTRER',
        boutiqueId,
        contenu: {
          id: venteId,
          numero,
          dateVente: new Date().toISOString(),
          clientId: client?.id ?? null,
          lignes: calcul.lignes.map((l) => ({
            id: Crypto.randomUUID(),
            produitId: l.produitId,
            articleId: l.articleId,
            quantite: l.quantite,
            tarif: l.tarif,
            prixUnitaire: l.prixUnitaire,
          })),
          remise: calcul.remise,
          paiements: listePaiements.map((p) => ({ ...p, id: Crypto.randomUUID() })),
          autorisationRemise:
            calcul.remise && pourcentage > plafond ? (autorisation?.jeton ?? null) : null,
        },
      });
      setDerniere({ id: venteId, numero, total: calcul.total, rendu: controle.rendu });
      setArticles([]);
      setClient(null);
      setRemise('');
      setAutorisation(null);
      setPaiements(PAIEMENTS_VIDES);
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const saisie = [
    styles.saisie,
    { color: colors.text, borderColor: colors.border, backgroundColor: colors.card },
  ];

  return (
    <Ecran titre="Vente" sousTitre={boutique.nom} enHaut>
      {derniere ? (
        <Carte>
          <Texte gras>Vente enregistrée · facture {derniere.numero}</Texte>
          <Texte>Total : {formaterMontant(derniere.total, monnaie)}</Texte>
          {derniere.rendu > 0 ? (
            <Texte gras>Monnaie à rendre : {formaterMontant(derniere.rendu, monnaie)}</Texte>
          ) : null}
          <Bouton
            titre="Reçu, facture, WhatsApp…"
            onPress={() => router.push({ pathname: '/vente/[id]', params: { id: derniere.id } })}
          />
          <Bouton titre="Nouvelle vente" variante="secondaire" onPress={() => setDerniere(null)} />
        </Carte>
      ) : null}

      <Champ
        libelle="Produit (nom, code-barres ou IMEI)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
        autoFocus={!scannerDisponible}
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
                <Text style={{ color: colors.primary }}>{a.imei}</Text>
              </Pressable>
            ))}
          </View>
          <Bouton titre="Fermer" variante="secondaire" onPress={() => setChoixImei(null)} />
        </Carte>
      ) : null}
      <Message texte={message} />

      <Carte>
        <Texte gras>Panier</Texte>
        {calcul.lignes.length === 0 ? <Texte discret>Scannez ou cherchez un produit.</Texte> : null}
        {calcul.lignes.map((l) => (
          <View key={l.cle} style={styles.ligne}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{l.nom}</Text>
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

      <Carte>
        <Texte gras>
          Client{' '}
          {client
            ? `: ${client.nom}${client.type === 'GROSSISTE' ? ' (grossiste, prix de gros)' : ''}`
            : '(facultatif)'}
        </Texte>
        {client ? (
          <Bouton titre="Retirer le client" variante="secondaire" onPress={() => setClient(null)} />
        ) : (
          <>
            <TextInput
              value={rechercheClient}
              onChangeText={setRechercheClient}
              placeholder="Nom ou téléphone"
              placeholderTextColor="#8a8a8a"
              accessibilityLabel="Rechercher un client"
              style={saisie}
            />
            {clients?.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                onPress={() => {
                  setClient(c);
                  setRechercheClient('');
                }}
              >
                <Texte>
                  {c.nom} · {c.telephone}
                </Texte>
              </Pressable>
            ))}
          </>
        )}
      </Carte>

      <Carte>
        <Texte gras>Remise (vous accordez jusqu’à {plafond} %)</Texte>
        <TextInput
          value={remise}
          onChangeText={(t) => setRemise(t)}
          keyboardType="number-pad"
          placeholder="Montant de la remise"
          placeholderTextColor="#8a8a8a"
          accessibilityLabel="Montant de la remise"
          style={saisie}
        />
        {calcul.remise > 0 ? <Texte discret>Soit {pourcentage} % du sous-total.</Texte> : null}
        {autorisation && !autorisationNecessaire && pourcentage > plafond ? (
          <Texte discret>
            Validée par {autorisation.gerant} (jusqu’à {autorisation.plafond} %).
          </Texte>
        ) : null}
        {autorisationNecessaire ? (
          <>
            <Texte>
              Au-delà de {plafond} % : un gérant valide avec son code PIN (connexion nécessaire).
            </Texte>
            <TextInput
              value={gerantId}
              onChangeText={setGerantId}
              placeholder="Identifiant du gérant"
              placeholderTextColor="#8a8a8a"
              autoCapitalize="none"
              style={saisie}
            />
            <TextInput
              value={gerantPin}
              onChangeText={setGerantPin}
              placeholder="Code PIN du gérant"
              placeholderTextColor="#8a8a8a"
              keyboardType="number-pad"
              secureTextEntry
              style={saisie}
            />
            <Bouton
              titre="Faire valider la remise"
              variante="secondaire"
              onPress={() => void demanderAutorisation()}
            />
          </>
        ) : null}
      </Carte>

      <Carte>
        <Texte gras>Paiement</Texte>
        {MOYENS_PAIEMENT.map((moyen) => (
          <View key={moyen} style={styles.paiement}>
            <Text style={{ color: colors.text, width: 120 }}>{LIBELLES_MOYENS[moyen]}</Text>
            <TextInput
              value={paiements[moyen].montant}
              onChangeText={(montant) =>
                setPaiements((p) => ({ ...p, [moyen]: { ...p[moyen], montant } }))
              }
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor="#8a8a8a"
              accessibilityLabel={`Montant en ${LIBELLES_MOYENS[moyen]}`}
              style={[saisie, { flex: 1, minWidth: 100 }]}
            />
            {moyenAvecReference(moyen) && entier(paiements[moyen].montant) > 0 ? (
              <TextInput
                value={paiements[moyen].reference}
                onChangeText={(reference) =>
                  setPaiements((p) => ({ ...p, [moyen]: { ...p[moyen], reference } }))
                }
                placeholder="Référence"
                placeholderTextColor="#8a8a8a"
                accessibilityLabel={`Référence ${LIBELLES_MOYENS[moyen]}`}
                style={[saisie, { flex: 1, minWidth: 120 }]}
              />
            ) : null}
          </View>
        ))}
        <Bouton
          titre="Tout en espèces"
          variante="secondaire"
          onPress={() =>
            setPaiements({
              ...PAIEMENTS_VIDES,
              ESPECES: { montant: String(calcul.total), reference: '' },
            })
          }
        />
      </Carte>

      <Carte>
        {calcul.remise > 0 ? (
          <Texte discret>Sous-total : {formaterMontant(calcul.sousTotal, monnaie)}</Texte>
        ) : null}
        <Text style={[styles.total, { color: colors.text }]}>
          Total : {formaterMontant(calcul.total, monnaie)}
        </Text>
        {paye > 0 ? (
          <Texte>
            Payé : {formaterMontant(paye, monnaie)}
            {paye < calcul.total ? ` · reste ${formaterMontant(calcul.total - paye, monnaie)}` : ''}
            {paye > calcul.total
              ? ` · monnaie ${formaterMontant(paye - calcul.total, monnaie)}`
              : ''}
          </Texte>
        ) : null}
      </Carte>
      <Bouton
        titre="Encaisser"
        onPress={() => void encaisser()}
        chargement={envoi}
        desactive={!articles.length}
      />
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      <Scanner
        visible={scanner}
        surCode={(code) => void lireCode(code)}
        fermer={() => setScanner(false)}
      />
    </Ecran>
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
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  paiement: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  total: { fontSize: 24, fontWeight: '800' },
});
