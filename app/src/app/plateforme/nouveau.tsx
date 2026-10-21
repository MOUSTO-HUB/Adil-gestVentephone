import { normaliserTelephone } from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { type AccesProvisoire, dateSaisie, usePlateforme } from '@/lib/plateforme';

interface Cree extends AccesProvisoire {
  commerceId: string;
  produits: number;
}

/** Nouveau commerçant abonné : commerce, première boutique, propriétaire, catalogue de base. */
export default function NouveauCommercant() {
  const { requete } = usePlateforme();
  const [commerce, setCommerce] = useState('');
  const [telephone, setTelephone] = useState('');
  const [boutique, setBoutique] = useState('');
  const [prefixe, setPrefixe] = useState('');
  const [adresse, setAdresse] = useState('');
  const [proprietaire, setProprietaire] = useState('');
  const [identifiant, setIdentifiant] = useState('');
  const [abonnement, setAbonnement] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [cree, setCree] = useState<Cree | null>(null);

  const valider = async () => {
    const numero = normaliserTelephone(telephone);
    const jusquAu = abonnement.trim() ? dateSaisie(abonnement) : undefined;
    if (!commerce.trim() || !boutique.trim() || !proprietaire.trim() || !identifiant.trim()) {
      setErreur('Remplissez le commerce, la boutique, le propriétaire et son identifiant.');
      return;
    }
    if (!numero) return setErreur('Numéro de téléphone invalide.');
    if (!/^[A-Za-z]{2,5}$/.test(prefixe.trim())) {
      return setErreur('Préfixe des factures : 2 à 5 lettres (ex. MAD).');
    }
    if (jusquAu === null) return setErreur('Date d’abonnement au format JJ/MM/AAAA.');
    setEnvoi(true);
    setErreur(null);
    try {
      setCree(
        await requete<Cree>('/commerces', {
          methode: 'POST',
          corps: {
            commerce: commerce.trim(),
            telephone: numero,
            boutique: boutique.trim(),
            prefixe: prefixe.trim().toUpperCase(),
            adresse: adresse.trim() || undefined,
            proprietaire: proprietaire.trim(),
            identifiant: identifiant.trim(),
            abonnementJusquAu: jusquAu,
          },
        }),
      );
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  if (cree) {
    return (
      <Ecran enHaut titre="Commerçant créé" sousTitre={commerce}>
        <Message
          type="succes"
          texte={`Boutique ouverte et catalogue de base installé (${cree.produits} articles, sans photo).`}
        />
        <Carte titre="Accès du propriétaire" icone="key">
          <Texte>Identifiant : {cree.identifiant}</Texte>
          <Texte gras>Mot de passe provisoire : {cree.motDePasse}</Texte>
          <Texte discret>
            Notez-le maintenant : il ne sera plus affiché. Le propriétaire choisira son code PIN à
            la première connexion.
          </Texte>
        </Carte>
        <Bouton
          titre="Ouvrir la fiche du commerçant"
          icone="storefront"
          onPress={() =>
            router.replace({
              pathname: '/plateforme/commerce/[id]',
              params: { id: cree.commerceId },
            })
          }
        />
      </Ecran>
    );
  }

  return (
    <Ecran enHaut titre="Nouveau commerçant" sousTitre="Abonnement à la plateforme">
      <Carte titre="Commerce" icone="storefront">
        <Champ
          libelle="Nom du commerce"
          value={commerce}
          onChangeText={setCommerce}
          placeholder="Adil Phone"
        />
        <Champ
          libelle="Téléphone"
          value={telephone}
          onChangeText={setTelephone}
          keyboardType="phone-pad"
          placeholder="620 00 00 00"
        />
        <Champ
          libelle="Abonnement payé jusqu’au (facultatif)"
          value={abonnement}
          onChangeText={setAbonnement}
          placeholder="JJ/MM/AAAA"
        />
      </Carte>
      <Carte titre="Première boutique" icone="business">
        <Champ
          libelle="Nom de la boutique"
          value={boutique}
          onChangeText={setBoutique}
          placeholder="Adil Phone Madina"
        />
        <Champ
          libelle="Préfixe des factures (2 à 5 lettres)"
          value={prefixe}
          onChangeText={setPrefixe}
          autoCapitalize="characters"
          maxLength={5}
          placeholder="MAD"
        />
        <Champ
          libelle="Adresse (facultatif)"
          value={adresse}
          onChangeText={setAdresse}
          placeholder="Marché Madina, Conakry"
        />
      </Carte>
      <Carte titre="Propriétaire" icone="person">
        <Champ libelle="Nom complet" value={proprietaire} onChangeText={setProprietaire} />
        <Champ
          libelle="Identifiant de connexion"
          value={identifiant}
          onChangeText={setIdentifiant}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Texte discret>Un mot de passe provisoire sera créé et affiché une seule fois.</Texte>
      </Carte>
      <Message texte={erreur} />
      <Bouton
        titre="Créer le commerçant"
        icone="checkmark-circle"
        onPress={valider}
        chargement={envoi}
      />
    </Ecran>
  );
}
