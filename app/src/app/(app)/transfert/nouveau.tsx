import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { SaisieImei } from '@/components/saisie-imei';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { numeroAchat } from '@/lib/achats';
import { rechercherProduits } from '@/lib/catalogue';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';
import { boutiquesDuCommerce } from '@/lib/transferts';

interface Ligne {
  produitId: string;
  nom: string;
  quantite: string;
  disponible: number;
}

/**
 * Nouveau transfert. Demande : la boutique courante reçoit, elle choisit la boutique
 * de départ et les quantités. Envoi direct (propriétaire) : téléphones scannés et
 * accessoires comptés partent tout de suite.
 */
export default function NouveauTransfert() {
  const { mode } = useLocalSearchParams<{ mode: 'demande' | 'envoi' }>();
  const envoi = mode === 'envoi';
  const c = useCouleurs();
  const { profil, boutique, api } = useSession();
  const { enregistrer } = useSync();
  const [autre, setAutre] = useState<string | null>(null);
  const [recherche, setRecherche] = useState('');
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [imeis, setImeis] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const boutiqueId = boutique?.id ?? '';

  const boutiques = useLecture(
    (b) => boutiquesDuCommerce(b, api, profil?.boutiques ?? []),
    [api, profil?.boutiques],
  );
  const resultats = useLecture(
    async (b) =>
      recherche.trim()
        ? rechercherProduits(b, boutiqueId, recherche, {
            limite: 8,
            type: envoi ? 'ACCESSOIRE' : null,
          })
        : [],
    [recherche, boutiqueId, envoi],
  );
  // Téléphones en stock ici, par IMEI (envoi direct).
  const telephones = useLecture(
    async (b) =>
      envoi
        ? new Map(
            (
              await b.tous<{ id: string; imei: string; produitId: string }>(
                "SELECT id, imei, produitId FROM article WHERE boutiqueId = ? AND statut = 'EN_STOCK'",
                [boutiqueId],
              )
            ).map((a) => [a.imei, a]),
          )
        : new Map<string, { id: string; imei: string; produitId: string }>(),
    [boutiqueId, envoi],
  );

  if (!profil || !boutique)
    return (
      <Ecran titre="Transfert" enHaut>
        {null}
      </Ecran>
    );
  const autres = (boutiques ?? []).filter((b) => b.id !== boutiqueId);

  const ajouter = (p: { id: string; nom: string; quantite: number }) => {
    setRecherche('');
    if (lignes.some((l) => l.produitId === p.id)) return;
    setLignes((ls) => [
      ...ls,
      { produitId: p.id, nom: p.nom, quantite: '1', disponible: p.quantite },
    ]);
  };

  const valider = async () => {
    setMessage(null);
    if (!autre)
      return setMessage(
        envoi ? 'Choisissez la boutique qui reçoit.' : 'Choisissez la boutique de départ.',
      );
    const quantites = lignes.map((l) => ({ ...l, n: Number(l.quantite) }));
    if (quantites.some((l) => !Number.isInteger(l.n) || l.n < 1)) {
      return setMessage('Quantités : nombres entiers à partir de 1.');
    }
    if (envoi && quantites.some((l) => l.n > l.disponible)) {
      return setMessage('Quantité supérieure au stock de la boutique.');
    }
    if (!quantites.length && !imeis.length) return setMessage('Ajoutez au moins un produit.');
    setEnvoiEnCours(true);
    try {
      const id = Crypto.randomUUID();
      const numero = numeroAchat('TR', new Date());
      if (envoi) {
        await enregistrer({
          type: 'TRANSFERT_ENVOYER',
          boutiqueId,
          contenu: {
            id,
            numero,
            boutiqueArriveeId: autre,
            note: note.trim() || null,
            lignes: [
              ...imeis.map((imei) => {
                const a = telephones!.get(imei)!;
                return {
                  id: Crypto.randomUUID(),
                  produitId: a.produitId,
                  articleId: a.id,
                  quantite: 1,
                };
              }),
              ...quantites.map((l) => ({
                id: Crypto.randomUUID(),
                produitId: l.produitId,
                articleId: null,
                quantite: l.n,
              })),
            ],
          },
        });
      } else {
        await enregistrer({
          type: 'TRANSFERT_DEMANDER',
          boutiqueId,
          contenu: {
            id,
            numero,
            boutiqueDepartId: autre,
            note: note.trim() || null,
            lignes: quantites.map((l) => ({
              id: Crypto.randomUUID(),
              produitId: l.produitId,
              quantite: l.n,
            })),
          },
        });
      }
      router.replace({ pathname: '/transfert/[id]', params: { id } });
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Ecran titre={envoi ? 'Envoi direct' : 'Demande de stock'} sousTitre={boutique.nom} enHaut>
      <Choix
        libelle={envoi ? 'Boutique qui reçoit' : 'Boutique qui envoie'}
        options={autres.map((b) => ({ id: b.id, nom: b.nom }))}
        valeurs={autre ? [autre] : []}
        surChoix={([v]) => setAutre(v ?? null)}
      />
      {autres.length === 0 ? (
        <Message type="info" texte="Le commerce n’a pas d’autre boutique ouverte." />
      ) : null}

      {envoi ? (
        <Carte titre="Téléphones" icone="phone-portrait">
          <SaisieImei
            libelle="IMEI scannés"
            imeis={imeis}
            surChangement={setImeis}
            refus={(imei) =>
              telephones?.has(imei) ? null : `${imei} n’est pas en stock dans cette boutique.`
            }
          />
        </Carte>
      ) : null}

      <Carte titre={envoi ? 'Accessoires' : 'Produits demandés'} icone="cube">
        <TextInput
          value={recherche}
          onChangeText={setRecherche}
          placeholder={envoi ? 'Rechercher un accessoire' : 'Rechercher un produit'}
          placeholderTextColor={c.texteDiscret}
          accessibilityLabel="Rechercher un produit"
          style={saisie}
        />
        {resultats?.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => ajouter(p)}
            style={[styles.resultat, { borderColor: c.bordure }]}
          >
            <Texte>{p.nom}</Texte>
            <Texte discret>{p.quantite} ici</Texte>
          </Pressable>
        ))}
        {lignes.map((l) => (
          <View key={l.produitId} style={styles.ligne}>
            <View style={{ flex: 1 }}>
              <Texte>{l.nom}</Texte>
              {envoi ? <Texte discret>{l.disponible} en stock</Texte> : null}
            </View>
            <TextInput
              value={l.quantite}
              onChangeText={(quantite) =>
                setLignes((ls) =>
                  ls.map((x) => (x.produitId === l.produitId ? { ...x, quantite } : x)),
                )
              }
              keyboardType="number-pad"
              accessibilityLabel={`Quantité de ${l.nom}`}
              style={[saisie, { width: 80 }]}
            />
            <Bouton
              titre="Retirer"
              variante="secondaire"
              onPress={() => setLignes((ls) => ls.filter((x) => x.produitId !== l.produitId))}
            />
          </View>
        ))}
      </Carte>
      <Champ libelle="Note (facultatif)" value={note} onChangeText={setNote} />
      <Message texte={message} />
      <Bouton
        titre={envoi ? 'Envoyer' : 'Envoyer la demande'}
        icone="paper-plane"
        onPress={() => void valider()}
        chargement={envoiEnCours}
      />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
  resultat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
