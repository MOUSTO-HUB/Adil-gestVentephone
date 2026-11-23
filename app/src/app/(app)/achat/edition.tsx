import {
  type AchatSync,
  formaterMontant,
  type FournisseurSync,
  schemaAchat,
  totalAchat,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { type LigneDetaillee, lignesAchat, numeroAchat } from '@/lib/achats';
import { rechercherProduits } from '@/lib/catalogue';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface LigneSaisie {
  id: string;
  produitId: string;
  nom: string;
  quantite: string;
  prixAchat: string;
}

/** Création (sans id) ou modification d'un bon d'achat encore à réceptionner. */
export default function EditionAchat() {
  // produitId : ouvert depuis une fiche produit (« Ajouter du stock »), produit déjà dans le bon.
  const { id, produitId } = useLocalSearchParams<{ id?: string; produitId?: string }>();
  const donnees = useLecture(
    async (b) => ({
      achat: id ? await b.premier<AchatSync>('SELECT * FROM achat WHERE id = ?', [id]) : null,
      lignes: id ? await lignesAchat(b, id) : ([] as LigneDetaillee[]),
      produitInitial:
        !id && produitId
          ? await b.premier<{ id: string; nom: string; prixAchat: number | null }>(
              'SELECT id, nom, prixAchat FROM produit WHERE id = ?',
              [produitId],
            )
          : null,
      fournisseurs: await b.tous<FournisseurSync>(
        'SELECT * FROM fournisseur WHERE archive = 0 ORDER BY nom',
      ),
    }),
    [id, produitId],
  );
  if (!donnees)
    return (
      <Ecran titre="Bon d’achat" enHaut>
        {null}
      </Ecran>
    );
  if (donnees.achat && donnees.achat.statut !== 'BROUILLON') {
    return (
      <Ecran titre="Bon d’achat" enHaut>
        <Message texte="Ce bon a déjà été réceptionné ou annulé : il ne peut plus être modifié." />
      </Ecran>
    );
  }
  return <Formulaire {...donnees} />;
}

const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

function Formulaire({
  achat,
  lignes: lignesExistantes,
  fournisseurs,
  produitInitial,
}: {
  achat: AchatSync | null;
  lignes: LigneDetaillee[];
  fournisseurs: FournisseurSync[];
  produitInitial: { id: string; nom: string; prixAchat: number | null } | null;
}) {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const [fournisseurId, setFournisseurId] = useState(achat?.fournisseurId ?? '');
  const [dateAchat, setDateAchat] = useState(
    achat?.dateAchat ?? new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(achat?.note ?? '');
  const [lignes, setLignes] = useState<LigneSaisie[]>(() =>
    produitInitial
      ? [
          {
            id: Crypto.randomUUID(),
            produitId: produitInitial.id,
            nom: produitInitial.nom,
            quantite: '1',
            prixAchat: produitInitial.prixAchat === null ? '' : String(produitInitial.prixAchat),
          },
        ]
      : lignesExistantes.map((l) => ({
          id: l.id,
          produitId: l.produitId,
          nom: l.nom,
          quantite: String(l.quantite),
          prixAchat: String(l.prixAchat),
        })),
  );
  const [recherche, setRecherche] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const resultats = useLecture(
    async (b) =>
      recherche.trim() ? rechercherProduits(b, boutique?.id ?? '', recherche, { limite: 8 }) : [],
    [recherche, boutique?.id],
  );
  const prixAchatProduit = useLecture(
    async (b) =>
      new Map(
        (
          await b.tous<{ id: string; prixAchat: number | null }>(
            'SELECT id, prixAchat FROM produit',
          )
        ).map((p) => [p.id, p.prixAchat]),
      ),
    [],
  );

  const ajouter = (produit: { id: string; nom: string }) => {
    setRecherche('');
    if (lignes.some((l) => l.produitId === produit.id)) return;
    setLignes((ls) => [
      ...ls,
      {
        id: Crypto.randomUUID(),
        produitId: produit.id,
        nom: produit.nom,
        quantite: '1',
        prixAchat: String(prixAchatProduit?.get(produit.id) ?? ''),
      },
    ]);
  };

  const modifier = (id: string, champ: 'quantite' | 'prixAchat', valeur: string) =>
    setLignes((ls) => ls.map((l) => (l.id === id ? { ...l, [champ]: valeur } : l)));

  const lignesNombres = lignes.map((l) => ({
    id: l.id,
    produitId: l.produitId,
    quantite: entier(l.quantite),
    prixAchat: entier(l.prixAchat),
  }));
  const valides = lignesNombres.every(
    (l) => Number.isInteger(l.quantite) && Number.isInteger(l.prixAchat),
  );

  const enregistrerBon = async () => {
    setErreur(null);
    if (!fournisseurId) {
      setErreur('Choisissez le fournisseur (ou créez-le dans Fournisseurs).');
      return;
    }
    if (!valides) {
      setErreur('Quantités et prix d’achat : nombres entiers attendus.');
      return;
    }
    if (!boutique) return;
    const saisie = schemaAchat.safeParse({
      id: achat?.id ?? Crypto.randomUUID(),
      fournisseurId,
      numero: achat?.numero ?? numeroAchat(boutique.prefixe, new Date()),
      dateAchat,
      note: note.trim() || null,
      lignes: lignesNombres,
    });
    if (!saisie.success) {
      setErreur(saisie.error.issues.map((i) => i.message).join('\n'));
      return;
    }
    setEnvoi(true);
    try {
      await enregistrer({
        type: 'ACHAT_ENREGISTRER',
        boutiqueId: boutique.id,
        contenu: saisie.data,
      });
      router.replace({ pathname: '/achat/[id]', params: { id: saisie.data.id } });
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  };

  return (
    <Ecran
      titre={achat ? `Bon ${achat.numero}` : 'Ajouter du stock (bon d’achat)'}
      sousTitre={boutique?.nom}
      enHaut
    >
      {fournisseurs.length ? (
        <Choix
          libelle="Fournisseur"
          options={fournisseurs}
          valeurs={fournisseurId ? [fournisseurId] : []}
          surChoix={([f]) => f && setFournisseurId(f)}
        />
      ) : (
        <>
          <Message texte="Aucun fournisseur pour l’instant : créez celui qui vous livre (ou « Achat divers »)." />
          <Bouton
            titre="Créer un fournisseur"
            icone="business"
            variante="secondaire"
            onPress={() => router.push('/fournisseur/edition')}
          />
        </>
      )}
      <Champ libelle="Date du bon (AAAA-MM-JJ)" value={dateAchat} onChangeText={setDateAchat} />
      <Champ
        libelle="Ajouter un produit (nom, code-barres)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
      />
      {resultats?.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          onPress={() => ajouter(p)}
          style={[styles.resultat, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.text }}>+ {p.nom}</Text>
        </Pressable>
      ))}
      {lignes.map((l) => (
        <Carte key={l.id}>
          <View style={styles.entete}>
            <Texte gras>{l.nom}</Texte>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Retirer ${l.nom}`}
              onPress={() => setLignes((ls) => ls.filter((x) => x.id !== l.id))}
            >
              <Text style={{ color: colors.notification, fontWeight: '700' }}>Retirer</Text>
            </Pressable>
          </View>
          <View style={styles.chiffres}>
            <View style={styles.chiffre}>
              <Text style={{ color: colors.text }}>Quantité</Text>
              <TextInput
                value={l.quantite}
                onChangeText={(t) => modifier(l.id, 'quantite', t)}
                keyboardType="number-pad"
                accessibilityLabel={`Quantité de ${l.nom}`}
                style={[styles.saisie, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
            <View style={styles.chiffre}>
              <Text style={{ color: colors.text }}>Prix d’achat unitaire</Text>
              <TextInput
                value={l.prixAchat}
                onChangeText={(t) => modifier(l.id, 'prixAchat', t)}
                keyboardType="number-pad"
                accessibilityLabel={`Prix d’achat de ${l.nom}`}
                style={[styles.saisie, { color: colors.text, borderColor: colors.border }]}
              />
            </View>
          </View>
        </Carte>
      ))}
      {lignes.length && valides ? (
        <Texte gras>Total : {formaterMontant(totalAchat(lignesNombres), monnaie)}</Texte>
      ) : null}
      <Champ libelle="Note" value={note} onChangeText={setNote} />
      <Message texte={erreur} />
      <Bouton titre="Enregistrer le bon" onPress={() => void enregistrerBon()} chargement={envoi} />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  resultat: { borderWidth: 1, borderRadius: 8, padding: 10 },
  entete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  chiffres: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  chiffre: { flex: 1, minWidth: 120, gap: 4 },
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
});
