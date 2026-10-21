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
import { Choix } from '@/components/choix';
import { ChoixArticles } from '@/components/choix-articles';
import { SaisieTroc } from '@/components/saisie-troc';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { caisseOuverte } from '@/lib/caisse-session';
import { rechercherClients } from '@/lib/clients';
import { type ArticlePanier, prixDuPanier, prochainNumeroFacture } from '@/lib/panier';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { envoyerPhotosTroc } from '@/lib/photos-troc';
import {
  etatDuFormulaire,
  type FormulaireTroc,
  formulaireTrocVide,
  montantSaisi,
  proposerReprise,
  trocDepuisFormulaire,
} from '@/lib/troc';

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
 * (mixte possible), troc de l'ancien téléphone du client. La vente s'enregistre sur
 * l'appareil, même hors ligne ; les photos du troc partent ensuite, en ligne.
 */
export default function Vente() {
  const { colors } = useTheme();
  const { profil, boutique, api } = useSession();
  const { base, enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const [articles, setArticles] = useState<ArticlePanier[]>([]);
  const [client, setClient] = useState<ClientSync | null>(null);
  /** Facture envoyée au client par le serveur après l'encaissement (si un client est choisi). */
  const [envoiFacture, setEnvoiFacture] = useState<'NON' | 'SMS' | 'WHATSAPP'>('SMS');
  const [rechercheClient, setRechercheClient] = useState('');
  const [remise, setRemise] = useState('');
  const [autorisation, setAutorisation] = useState<Autorisation | null>(null);
  const [gerantId, setGerantId] = useState('');
  const [gerantPin, setGerantPin] = useState('');
  const [paiements, setPaiements] = useState<Paiements>(PAIEMENTS_VIDES);
  const [message, setMessage] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [troc, setTroc] = useState<FormulaireTroc | null>(null);
  const [infoPhotos, setInfoPhotos] = useState<string | null>(null);
  const [derniere, setDerniere] = useState<{
    id: string;
    numero: string;
    total: number;
    rendu: number;
    reprise: number;
  } | null>(null);
  const boutiqueId = boutique?.id ?? '';

  const caisse = useLecture(
    (b) => (profil ? caisseOuverte(b, boutiqueId, profil.id) : Promise.resolve(null)),
    [boutiqueId, profil?.id],
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
  // Valeur de l'ancien téléphone déduite du total (troc).
  const reprise = troc ? Math.max(0, montantSaisi(troc.valeur) || 0) : 0;
  const totalNet = calcul.total - reprise;
  const plafond = plafondRemise(profil.role, profil.commerce);
  const pourcentage = pourcentageRemise(calcul.remise, calcul.sousTotal);
  const autorisationNecessaire =
    pourcentage > plafond && (!autorisation || pourcentage > autorisation.plafond);
  // L'avoir n'est proposé qu'à un client qui en a un.
  const moyens = MOYENS_PAIEMENT.filter((m) => m !== 'AVOIR' || (client?.soldeAvoir ?? 0) > 0);
  const listePaiements = moyens.flatMap((moyen) => {
    const montant = entier(paiements[moyen].montant);
    return montant > 0
      ? [{ moyen, montant, reference: paiements[moyen].reference.trim() || null }]
      : [];
  });
  const paye = listePaiements.reduce((t, p) => t + p.montant, 0);

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
    if (!caisse) return setMessage('Ouvrez votre caisse avant d’encaisser.');
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
    if (reprise > calcul.total) return setMessage('La reprise dépasse le montant de la vente.');
    let trocSaisi = null;
    if (troc) {
      const proposition = troc.produit
        ? await proposerReprise(base, boutiqueId, troc.produit.id, etatDuFormulaire(troc))
        : null;
      const resultat = trocDepuisFormulaire(troc, proposition?.valeur ?? 0);
      if ('erreur' in resultat) return setMessage(resultat.erreur);
      trocSaisi = resultat.troc;
    }
    const controle = controlerPaiements(totalNet, listePaiements);
    if (!controle.ok) return setMessage(controle.motif);
    setEnvoi(true);
    try {
      const numero = await prochainNumeroFacture(
        base,
        boutique.prefixe,
        profil.appareilId,
        profil.dernierOrdreFacture,
      );
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
          caisseId: caisse.id,
          troc: trocSaisi,
        },
      });
      if (client && envoiFacture !== 'NON') {
        await enregistrer({
          type: 'MESSAGE_ENVOYER',
          boutiqueId,
          contenu: {
            id: Crypto.randomUUID(),
            venteId,
            type: 'FACTURE',
            canal: envoiFacture,
            telephone: null,
          },
        });
      }
      setDerniere({ id: venteId, numero, total: totalNet, rendu: controle.rendu, reprise });
      // Photos du troc : envoyées dès que la vente est arrivée sur le serveur.
      if (trocSaisi && troc?.photos.length) {
        const photos = troc.photos;
        setInfoPhotos('Envoi des photos de l’appareil repris…');
        envoyerPhotosTroc(api, trocSaisi.id, photos).then(
          (n) => setInfoPhotos(`${n} photo(s) de l’appareil repris enregistrée(s).`),
          () =>
            setInfoPhotos(
              'Photos non envoyées (hors ligne) : ajoutez-les depuis l’écran Trocs une fois en ligne.',
            ),
        );
      } else {
        setInfoPhotos(null);
      }
      setTroc(null);
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
          {derniere.reprise > 0 ? (
            <Texte>
              Reprise de l’ancien téléphone : {formaterMontant(derniere.reprise, monnaie)}
            </Texte>
          ) : null}
          <Texte>À payer : {formaterMontant(derniere.total, monnaie)}</Texte>
          <Message type="info" texte={infoPhotos} />
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

      {caisse === null ? (
        <Carte>
          <Texte gras>Caisse fermée</Texte>
          <Texte discret>Ouvrez votre caisse (fond de caisse) avant la première vente.</Texte>
          <Bouton titre="Ouvrir la caisse" onPress={() => router.push('/caisse')} />
        </Carte>
      ) : null}
      <Message texte={message} />
      <ChoixArticles
        boutiqueId={boutiqueId}
        monnaie={monnaie}
        articles={articles}
        setArticles={setArticles}
        lignes={calcul.lignes}
      />

      <Carte>
        <Texte gras>
          Client{' '}
          {client
            ? `: ${client.nom}${client.type === 'GROSSISTE' ? ' (grossiste, prix de gros)' : ''}`
            : '(facultatif)'}
        </Texte>
        {client ? (
          <>
            <Choix
              libelle="Envoyer la facture au client"
              options={[
                { id: 'SMS', nom: 'Par SMS' },
                { id: 'WHATSAPP', nom: 'Par WhatsApp' },
                { id: 'NON', nom: 'Non' },
              ]}
              valeurs={[envoiFacture]}
              surChoix={([v]) => v && setEnvoiFacture(v as 'NON' | 'SMS' | 'WHATSAPP')}
            />
            <Bouton
              titre="Retirer le client"
              variante="secondaire"
              onPress={() => setClient(null)}
            />
          </>
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

      {troc ? (
        <>
          <SaisieTroc
            formulaire={troc}
            surChange={setTroc}
            client={client}
            boutiqueId={boutiqueId}
            monnaie={monnaie}
            role={profil.role}
            repriseMaxVendeur={profil.commerce.repriseMaxVendeur}
            api={api}
          />
          <Bouton titre="Retirer le troc" variante="secondaire" onPress={() => setTroc(null)} />
        </>
      ) : (
        <Bouton
          titre="Troc : reprendre l’ancien téléphone du client"
          icone="swap-horizontal"
          variante="secondaire"
          onPress={() => setTroc(formulaireTrocVide(Crypto.randomUUID(), Crypto.randomUUID()))}
        />
      )}

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
        {moyens.map((moyen) => (
          <View key={moyen} style={styles.paiement}>
            <Text style={{ color: colors.text, width: 120 }}>
              {LIBELLES_MOYENS[moyen]}
              {moyen === 'AVOIR' && client
                ? ` (solde ${formaterMontant(client.soldeAvoir, monnaie)})`
                : ''}
            </Text>
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
              ESPECES: { montant: String(Math.max(0, totalNet)), reference: '' },
            })
          }
        />
      </Carte>

      <Carte>
        {calcul.remise > 0 || reprise > 0 ? (
          <Texte discret>Sous-total : {formaterMontant(calcul.sousTotal, monnaie)}</Texte>
        ) : null}
        {calcul.remise > 0 ? (
          <Texte discret>Remise : − {formaterMontant(calcul.remise, monnaie)}</Texte>
        ) : null}
        {reprise > 0 ? (
          <Texte discret>Reprise (troc) : − {formaterMontant(reprise, monnaie)}</Texte>
        ) : null}
        <Text style={[styles.total, { color: colors.text }]}>
          {reprise > 0 ? 'À payer' : 'Total'} : {formaterMontant(totalNet, monnaie)}
        </Text>
        {paye > 0 ? (
          <Texte>
            Payé : {formaterMontant(paye, monnaie)}
            {paye < totalNet ? ` · reste ${formaterMontant(totalNet - paye, monnaie)}` : ''}
            {paye > totalNet ? ` · monnaie ${formaterMontant(paye - totalNet, monnaie)}` : ''}
          </Texte>
        ) : null}
      </Carte>
      <Bouton
        titre="Encaisser"
        onPress={() => void encaisser()}
        chargement={envoi}
        desactive={!articles.length}
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
  paiement: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  total: { fontSize: 24, fontWeight: '800' },
});
