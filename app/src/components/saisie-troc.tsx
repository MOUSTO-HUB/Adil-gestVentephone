import Ionicons from '@expo/vector-icons/Ionicons';
import {
  type ClientSync,
  DESTINATIONS_REPRISE,
  ETATS_COMPOSANT,
  formaterMontant,
  imeiValide,
  LIBELLES_DESTINATIONS_REPRISE,
  LIBELLES_ETATS_COMPOSANT,
  LIBELLES_ETATS_REPRISE,
  LIBELLES_MOTIFS_IMEI,
  normaliserImei,
  PHOTOS_TROC_MAX,
  plafondReprise,
  REPRISE_MAX_VENDEUR_DEFAUT,
  type Role,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Message, Texte } from '@/components/ui';
import { type ClientApi, messageErreur } from '@/lib/api';
import { rechercherProduits } from '@/lib/catalogue';
import { choisirPhoto } from '@/lib/photo';
import { articleParImei, imeiSignaleActif } from '@/lib/sync/operations-trocs';
import { useLecture } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';
import { etatDuFormulaire, type FormulaireTroc, montantSaisi, proposerReprise } from '@/lib/troc';

const options = <T extends string>(valeurs: readonly T[], libelles: Record<T, string>) =>
  valeurs.map((id) => ({ id, nom: libelles[id] }));

/**
 * Troc sur l'écran de vente : modèle et IMEI de l'ancien téléphone, état des
 * composants, valeur proposée (grille ou estimation) et retenue, destination,
 * photos. Au-delà de sa limite, le vendeur fait valider la valeur par un gérant.
 */
export function SaisieTroc({
  formulaire: f,
  surChange,
  client,
  boutiqueId,
  monnaie,
  role,
  repriseMaxVendeur = REPRISE_MAX_VENDEUR_DEFAUT,
  api,
}: {
  formulaire: FormulaireTroc;
  surChange: (f: FormulaireTroc) => void;
  client: ClientSync | null;
  boutiqueId: string;
  monnaie: string | undefined;
  role: Role;
  repriseMaxVendeur?: number;
  api: ClientApi;
}) {
  const c = useCouleurs();
  const [recherche, setRecherche] = useState('');
  const [gerantId, setGerantId] = useState('');
  const [gerantPin, setGerantPin] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const changer = (modif: Partial<FormulaireTroc>) => surChange({ ...f, ...modif });

  const etat = etatDuFormulaire(f);
  const modeles = useLecture(
    async (b) =>
      !f.produit && recherche.trim()
        ? rechercherProduits(b, boutiqueId, recherche, { type: 'TELEPHONE', limite: 6 })
        : [],
    [recherche, f.produit, boutiqueId],
  );
  const proposition = useLecture(
    (b) => (f.produit ? proposerReprise(b, boutiqueId, f.produit.id, etat) : Promise.resolve(null)),
    [f.produit?.id, etat, boutiqueId],
  );
  const imei = normaliserImei(f.imei);
  const controleImei = useLecture(
    async (b) =>
      imeiValide(imei)
        ? { signale: await imeiSignaleActif(b, imei), article: await articleParImei(b, imei) }
        : null,
    [imei],
  );

  const valeur = montantSaisi(f.valeur);
  const proposee = proposition?.valeur ?? 0;
  const plafond = plafondReprise(proposee, role, repriseMaxVendeur);
  const validationNecessaire =
    valeur > plafond && (!f.autorisation || valeur > f.autorisation.valeur);
  const sansPiece = client && (!client.typePiece || !client.numeroPiece?.trim());
  const dejaEnStock =
    controleImei?.article &&
    controleImei.article.statut !== 'VENDU' &&
    controleImei.article.statut !== 'REBUT';

  const demanderValidation = async () => {
    setErreur(null);
    try {
      const reponse = await api.requete<{ jeton: string; gerant: string; valeur: number }>(
        '/ventes/autorisations-reprise',
        {
          methode: 'POST',
          corps: { boutiqueId, identifiant: gerantId, pin: gerantPin, trocId: f.id, valeur },
        },
      );
      changer({ autorisation: reponse });
      setGerantPin('');
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const ajouterPhoto = async (source: 'camera' | 'galerie') => {
    setErreur(null);
    try {
      const uri = await choisirPhoto(source);
      if (uri) changer({ photos: [...f.photos, uri] });
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Carte titre="Troc : reprise de l’ancien téléphone" icone="swap-horizontal">
      {!client ? (
        <Message
          type="info"
          texte="Choisissez le client ci-dessous : sa fiche (avec pièce d’identité) est obligatoire pour un troc."
        />
      ) : sansPiece ? (
        <>
          <Message texte={`Enregistrez la pièce d’identité de ${client.nom} sur sa fiche.`} />
          <Bouton
            titre="Compléter la fiche client"
            variante="secondaire"
            icone="id-card-outline"
            onPress={() => router.push({ pathname: '/client/[id]', params: { id: client.id } })}
          />
        </>
      ) : null}

      <Texte gras>Modèle de l’appareil repris</Texte>
      {f.produit ? (
        <View style={styles.ligne}>
          <View style={{ flex: 1 }}>
            <Texte>{f.produit.nom}</Texte>
          </View>
          <Bouton
            titre="Changer"
            variante="secondaire"
            onPress={() => changer({ produit: null, valeur: '', autorisation: null })}
          />
        </View>
      ) : (
        <>
          <TextInput
            value={recherche}
            onChangeText={setRecherche}
            placeholder="Ex. iPhone 12, A10, Camon 15…"
            placeholderTextColor={c.texteDiscret}
            accessibilityLabel="Modèle de l’appareil repris"
            style={saisie}
          />
          {modeles?.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              onPress={() => {
                changer({ produit: { id: p.id, nom: p.nom }, valeur: '', autorisation: null });
                setRecherche('');
              }}
              style={[styles.resultat, { borderColor: c.bordure }]}
            >
              <Ionicons name="phone-portrait-outline" size={16} color={c.primaire} />
              <Texte>{p.nom}</Texte>
            </Pressable>
          ))}
          {recherche.trim() && modeles?.length === 0 ? (
            <Texte discret>
              Modèle absent du catalogue : ajoutez-le d’abord (Stock, nouveau produit).
            </Texte>
          ) : null}
        </>
      )}

      <TextInput
        value={f.imei}
        onChangeText={(texte) => changer({ imei: texte })}
        placeholder="IMEI de l’appareil (*#06#)"
        placeholderTextColor={c.texteDiscret}
        keyboardType="number-pad"
        maxLength={20}
        accessibilityLabel="IMEI de l’appareil repris"
        style={saisie}
      />
      {imei.length >= 15 && !imeiValide(imei) ? (
        <Texte discret>IMEI invalide : vérifiez les 15 chiffres.</Texte>
      ) : null}
      {controleImei?.signale ? (
        <Message
          texte={`IMEI signalé ${LIBELLES_MOTIFS_IMEI[controleImei.signale.motif].toLowerCase()}${
            controleImei.signale.note ? ` (${controleImei.signale.note})` : ''
          } : reprise interdite.`}
        />
      ) : null}
      {dejaEnStock ? <Message texte="Ce téléphone est déjà dans le stock du commerce." /> : null}
      {controleImei?.article && !dejaEnStock ? (
        <Message type="info" texte="Téléphone déjà vendu par le commerce : il revient en stock." />
      ) : null}

      <Choix
        libelle="Écran"
        options={options(ETATS_COMPOSANT, LIBELLES_ETATS_COMPOSANT)}
        valeurs={[f.etatEcran]}
        surChoix={([v]) => v && changer({ etatEcran: v as FormulaireTroc['etatEcran'] })}
      />
      <Choix
        libelle="Batterie"
        options={options(ETATS_COMPOSANT, LIBELLES_ETATS_COMPOSANT)}
        valeurs={[f.etatBatterie]}
        surChoix={([v]) => v && changer({ etatBatterie: v as FormulaireTroc['etatBatterie'] })}
      />
      <Choix
        libelle="Boîtier"
        options={options(ETATS_COMPOSANT, LIBELLES_ETATS_COMPOSANT)}
        valeurs={[f.etatBoitier]}
        surChoix={([v]) => v && changer({ etatBoitier: v as FormulaireTroc['etatBoitier'] })}
      />
      <Choix
        libelle="Fonctionnement"
        options={[
          { id: 'oui', nom: 'Fonctionne' },
          { id: 'non', nom: 'En panne' },
        ]}
        valeurs={[f.fonctionne ? 'oui' : 'non']}
        surChoix={([v]) => v && changer({ fonctionne: v === 'oui' })}
      />
      <Texte gras>État global : {LIBELLES_ETATS_REPRISE[etat]}</Texte>

      {proposition ? (
        <View style={styles.ligne}>
          <View style={{ flex: 1 }}>
            <Texte>
              Valeur proposée : {formaterMontant(proposition.valeur, monnaie)}
              {proposition.source === 'GRILLE' ? ' (grille)' : ' (estimation sur le prix du neuf)'}
            </Texte>
          </View>
          <Bouton
            titre="Retenir"
            variante="secondaire"
            onPress={() => changer({ valeur: String(proposition.valeur) })}
          />
        </View>
      ) : null}
      <TextInput
        value={f.valeur}
        onChangeText={(texte) => changer({ valeur: texte })}
        placeholder="Valeur de reprise retenue"
        placeholderTextColor={c.texteDiscret}
        keyboardType="number-pad"
        accessibilityLabel="Valeur de reprise retenue"
        style={saisie}
      />
      {Number.isFinite(plafond) && proposition ? (
        <Texte discret>Vous pouvez aller jusqu’à {formaterMontant(plafond, monnaie)}.</Texte>
      ) : null}
      {f.autorisation && !validationNecessaire && valeur > plafond ? (
        <Texte discret>
          Validée par {f.autorisation.gerant} jusqu’à{' '}
          {formaterMontant(f.autorisation.valeur, monnaie)}.
        </Texte>
      ) : null}
      {validationNecessaire && proposition ? (
        <>
          <Texte>Au-delà : un gérant valide avec son code PIN (connexion nécessaire).</Texte>
          <TextInput
            value={gerantId}
            onChangeText={setGerantId}
            placeholder="Identifiant du gérant"
            placeholderTextColor={c.texteDiscret}
            autoCapitalize="none"
            style={saisie}
          />
          <TextInput
            value={gerantPin}
            onChangeText={setGerantPin}
            placeholder="Code PIN du gérant"
            placeholderTextColor={c.texteDiscret}
            keyboardType="number-pad"
            secureTextEntry
            style={saisie}
          />
          <Bouton
            titre="Faire valider la reprise"
            variante="secondaire"
            onPress={() => void demanderValidation()}
          />
        </>
      ) : null}

      <Choix
        libelle="L’appareil repris part"
        options={options(DESTINATIONS_REPRISE, LIBELLES_DESTINATIONS_REPRISE)}
        valeurs={[f.destination]}
        surChoix={([v]) => v && changer({ destination: v as FormulaireTroc['destination'] })}
      />
      {f.destination === 'A_REVENDRE' ? (
        <TextInput
          value={f.prixRevente}
          onChangeText={(texte) => changer({ prixRevente: texte })}
          placeholder="Prix de revente d’occasion"
          placeholderTextColor={c.texteDiscret}
          keyboardType="number-pad"
          accessibilityLabel="Prix de revente d’occasion"
          style={saisie}
        />
      ) : (
        <Texte discret>Le prix de revente se fixe à la remise en vente, après réparation.</Texte>
      )}
      <TextInput
        value={f.note}
        onChangeText={(texte) => changer({ note: texte })}
        placeholder="Remarques (rayures, chargeur rendu, compte iCloud retiré…)"
        placeholderTextColor={c.texteDiscret}
        maxLength={300}
        accessibilityLabel="Remarques sur l’appareil repris"
        style={saisie}
      />

      <Texte gras>
        Photos de l’état ({f.photos.length}/{PHOTOS_TROC_MAX})
      </Texte>
      <View style={styles.photos}>
        {f.photos.map((uri) => (
          <View key={uri}>
            <Image source={{ uri }} style={styles.photo} accessibilityLabel="Photo de l’appareil" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retirer la photo"
              onPress={() => changer({ photos: f.photos.filter((p) => p !== uri) })}
              style={[styles.retirer, { backgroundColor: c.danger }]}
            >
              <Ionicons name="close" size={14} color="#FFFFFF" />
            </Pressable>
          </View>
        ))}
      </View>
      {f.photos.length < PHOTOS_TROC_MAX ? (
        <View style={styles.ligne}>
          {Platform.OS !== 'web' ? (
            <Bouton
              titre="Photographier"
              icone="camera-outline"
              variante="secondaire"
              onPress={() => void ajouterPhoto('camera')}
            />
          ) : null}
          <Bouton
            titre={Platform.OS === 'web' ? 'Ajouter une photo' : 'Galerie'}
            icone="images-outline"
            variante="secondaire"
            onPress={() => void ajouterPhoto('galerie')}
          />
        </View>
      ) : null}
      <Message texte={erreur} />
    </Carte>
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
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  resultat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 8 },
  retirer: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
