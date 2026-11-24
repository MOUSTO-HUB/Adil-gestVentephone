import {
  type AchatSync,
  formaterMontant,
  type FournisseurSync,
  normaliserTelephone,
  schemaAchat,
  schemaFournisseur,
  totalAchat,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Bouton,
  Carte,
  Champ,
  Ecran,
  ListeDeroulante,
  Message,
  styleSaisie,
  Texte,
} from '@/components/ui';
import { type LigneDetaillee, lignesAchat, prochainNumeroAchat } from '@/lib/achats';
import { rechercherProduits } from '@/lib/catalogue';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

interface LigneSaisie {
  id: string;
  produitId: string;
  nom: string;
  quantite: string;
  prixAchat: string;
  /** Déjà reçu (bon corrigé après réception) : la quantité ne descend pas en dessous. */
  quantiteRecue: number;
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
  if (donnees.achat?.statut === 'ANNULE') {
    return (
      <Ecran titre="Bon d’achat" enHaut>
        <Message texte="Ce bon a été annulé : il ne peut plus être modifié." />
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
  const cs = useCouleurs();
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
            quantiteRecue: 0,
          },
        ]
      : lignesExistantes.map((l) => ({
          id: l.id,
          produitId: l.produitId,
          nom: l.nom,
          quantite: String(l.quantite),
          prixAchat: String(l.prixAchat),
          quantiteRecue: l.quantiteRecue,
        })),
  );
  // Numéro du bon : donné automatiquement (BC + initiales de l'utilisateur + année + ordre).
  const numeroPropose = useLecture(
    async (b) => (achat ? achat.numero : prochainNumeroAchat(b, profil?.nom ?? '', new Date())),
    [achat?.numero, profil?.nom],
  );
  const numero = achat?.numero ?? numeroPropose ?? '';
  const [nouveauFournisseur, setNouveauFournisseur] = useState<{
    nom: string;
    telephone: string;
  } | null>(fournisseurs.length ? null : { nom: '', telephone: '' });
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
        quantiteRecue: 0,
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
    if (!nouveauFournisseur && !fournisseurId) {
      setErreur('Choisissez le fournisseur dans la liste, ou « Nouveau fournisseur ».');
      return;
    }
    if (!valides) {
      setErreur('Quantités et prix d’achat : nombres entiers attendus.');
      return;
    }
    const sousRecu = lignes.find((l) => entier(l.quantite) < l.quantiteRecue);
    if (sousRecu) {
      setErreur(
        `« ${sousRecu.nom} » : ${sousRecu.quantiteRecue} déjà reçu(s), la quantité ne peut pas être plus basse.`,
      );
      return;
    }
    if (!boutique) return;
    // Nouveau fournisseur saisi sur place : créé juste avant le bon.
    let idFournisseur = fournisseurId;
    if (nouveauFournisseur) {
      const fiche = schemaFournisseur.safeParse({
        id: Crypto.randomUUID(),
        nom: nouveauFournisseur.nom,
        telephone: nouveauFournisseur.telephone.trim()
          ? normaliserTelephone(nouveauFournisseur.telephone, profil?.commerce.indicatif ?? '+224')
          : null,
        adresse: null,
        note: null,
        archive: false,
      });
      if (!fiche.success) {
        setErreur(`Fournisseur : ${fiche.error.issues.map((i) => i.message).join(' ')}`);
        return;
      }
      try {
        await enregistrer({
          type: 'FOURNISSEUR_ENREGISTRER',
          boutiqueId: boutique.id,
          contenu: fiche.data,
        });
      } catch (e) {
        setErreur((e as Error).message);
        return;
      }
      idFournisseur = fiche.data.id;
      setFournisseurId(idFournisseur);
      setNouveauFournisseur(null);
    }
    const saisie = schemaAchat.safeParse({
      id: achat?.id ?? Crypto.randomUUID(),
      fournisseurId: idFournisseur,
      numero,
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

  const total = valides ? totalAchat(lignesNombres) : null;
  const saisieCellule = [
    styleSaisie(cs) as object,
    { minHeight: 40, paddingVertical: 6, paddingHorizontal: 8, fontSize: 15 },
  ];

  return (
    <Ecran
      titre={achat ? `Bon ${achat.numero}` : 'Ajouter du stock (bon d’achat)'}
      sousTitre={`N° ${numero} (automatique) · ${boutique?.nom ?? ''}`}
      enHaut
      large
    >
      {achat && achat.statut !== 'BROUILLON' ? (
        <Message
          type="info"
          texte="Bon déjà reçu : vous pouvez corriger le fournisseur, les prix et les quantités commandées (pas en dessous de ce qui est reçu)."
        />
      ) : null}
      <Carte titre="Fournisseur" icone="business">
        {nouveauFournisseur ? (
          <>
            <Champ
              libelle="Nom du nouveau fournisseur"
              value={nouveauFournisseur.nom}
              onChangeText={(nom) => setNouveauFournisseur((f) => f && { ...f, nom })}
              placeholder="Ex. Madina Télécom, Achat divers"
            />
            <Champ
              libelle="Téléphone (facultatif)"
              value={nouveauFournisseur.telephone}
              onChangeText={(telephone) => setNouveauFournisseur((f) => f && { ...f, telephone })}
              keyboardType="phone-pad"
            />
            {fournisseurs.length ? (
              <Bouton
                titre="Choisir un fournisseur existant"
                variante="secondaire"
                onPress={() => setNouveauFournisseur(null)}
              />
            ) : null}
          </>
        ) : (
          <ListeDeroulante
            libelle="Fournisseur"
            indication="Choisir le fournisseur…"
            options={[
              ...fournisseurs.map((f) => ({ valeur: f.id, libelle: f.nom })),
              { valeur: NOUVEAU, libelle: '＋ Nouveau fournisseur' },
            ]}
            valeur={fournisseurId || null}
            surChoix={(v) =>
              v === NOUVEAU
                ? setNouveauFournisseur({ nom: '', telephone: '' })
                : setFournisseurId(v)
            }
          />
        )}
        <Champ libelle="Date du bon (AAAA-MM-JJ)" value={dateAchat} onChangeText={setDateAchat} />
      </Carte>

      <Carte titre="Articles" icone="list">
        <View style={[styles.rangee, styles.entete, { borderBottomColor: cs.bordure }]}>
          <Text style={[styles.colProduit, styles.titreCol, { color: cs.texte }]}>Produit</Text>
          <Text style={[styles.colNombre, styles.titreCol, { color: cs.texte }]}>Qté</Text>
          <Text style={[styles.colPrix, styles.titreCol, { color: cs.texte }]}>Prix d’achat</Text>
          <Text style={[styles.colTotal, styles.titreCol, { color: cs.texte }]}>Total</Text>
          <View style={styles.colRetirer} />
        </View>
        {lignes.length === 0 ? (
          <Texte discret>Aucun article : cherchez un produit ci-dessous pour l’ajouter.</Texte>
        ) : null}
        {lignes.map((l) => {
          const q = entier(l.quantite);
          const prix = entier(l.prixAchat);
          return (
            <View key={l.id} style={[styles.rangee, { borderBottomColor: cs.bordure }]}>
              <View style={styles.colProduit}>
                <Text style={{ color: cs.texte, fontWeight: '600' }} numberOfLines={2}>
                  {l.nom}
                </Text>
                {l.quantiteRecue ? (
                  <Text style={{ color: cs.texteDiscret, fontSize: 12 }}>
                    {l.quantiteRecue} déjà reçu(s)
                  </Text>
                ) : null}
              </View>
              <TextInput
                value={l.quantite}
                onChangeText={(t) => modifier(l.id, 'quantite', t)}
                keyboardType="number-pad"
                accessibilityLabel={`Quantité de ${l.nom}`}
                style={[styles.colNombre, ...saisieCellule]}
              />
              <TextInput
                value={l.prixAchat}
                onChangeText={(t) => modifier(l.id, 'prixAchat', t)}
                keyboardType="number-pad"
                accessibilityLabel={`Prix d’achat de ${l.nom}`}
                style={[styles.colPrix, ...saisieCellule]}
              />
              <Text style={[styles.colTotal, { color: cs.texte, fontSize: 13 }]} numberOfLines={2}>
                {Number.isInteger(q) && Number.isInteger(prix)
                  ? formaterMontant(q * prix, monnaie)
                  : '—'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${l.nom}`}
                disabled={l.quantiteRecue > 0}
                onPress={() => setLignes((ls) => ls.filter((x) => x.id !== l.id))}
                style={[styles.colRetirer, { opacity: l.quantiteRecue > 0 ? 0.3 : 1 }]}
              >
                <Ionicons name="trash" size={20} color={cs.danger} />
              </Pressable>
            </View>
          );
        })}
        <View style={styles.rangee}>
          <Text style={[styles.colProduit, styles.titreCol, { color: cs.texte }]}>
            Total du bon
          </Text>
          <Text style={[styles.colTotalBon, styles.titreCol, { color: cs.texte }]}>
            {total !== null ? formaterMontant(total, monnaie) : '—'}
          </Text>
        </View>
        <Champ
          libelle="Ajouter un article (nom, code-barres)"
          value={recherche}
          onChangeText={setRecherche}
          autoCorrect={false}
          placeholder="Tapez le nom du produit…"
        />
        {resultats?.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => ajouter(p)}
            style={[styles.resultat, { borderColor: cs.bordure, backgroundColor: cs.carte }]}
          >
            <Ionicons name="add-circle" size={20} color={cs.primaire} />
            <Text style={{ color: cs.texte, flex: 1 }}>{p.nom}</Text>
          </Pressable>
        ))}
        <Bouton
          titre="Article absent du catalogue : créer le produit"
          icone="create"
          variante="secondaire"
          onPress={() => router.push('/produit/edition')}
        />
      </Carte>

      <Champ libelle="Note (facultatif)" value={note} onChangeText={setNote} />
      <Message texte={erreur} />
      <Bouton
        titre={achat ? 'Enregistrer les corrections' : 'Enregistrer le bon'}
        icone="save"
        onPress={() => void enregistrerBon()}
        chargement={envoi}
      />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

const NOUVEAU = '__nouveau__';

const styles = StyleSheet.create({
  resultat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  rangee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entete: { borderBottomWidth: 1.5 },
  titreCol: { fontWeight: '800', fontSize: 13 },
  colProduit: { flex: 1, minWidth: 90 },
  colNombre: { width: 56 },
  colPrix: { width: 96 },
  colTotal: { width: 96, textAlign: 'right' },
  colTotalBon: { width: 158, textAlign: 'right' },
  colRetirer: { width: 28, alignItems: 'center' },
});
