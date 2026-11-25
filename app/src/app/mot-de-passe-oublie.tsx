import { normaliserTelephone } from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { appeler, messageErreur } from '@/lib/api';

interface ContactConcepteur {
  nom: string | null;
  telephone: string | null;
  whatsapp: string | null;
  email: string | null;
}

/**
 * Mot de passe oublié : la demande part dans l'espace concepteur, qui donnera un nouveau
 * mot de passe ; le contact du concepteur est affiché pour l'appeler directement.
 */
export default function MotDePasseOublie() {
  const params = useLocalSearchParams<{ identifiant?: string }>();
  const [identifiant, setIdentifiant] = useState(params.identifiant ?? '');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [concepteur, setConcepteur] = useState<ContactConcepteur | null>(null);
  const [resultat, setResultat] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(
    null,
  );
  const [envoi, setEnvoi] = useState(false);
  const [envoyee, setEnvoyee] = useState(false);

  useEffect(() => {
    appeler<ContactConcepteur>('/aide/contact', {}).then(setConcepteur, () => setConcepteur(null));
  }, []);

  const envoyer = async () => {
    setResultat(null);
    if (!identifiant.trim()) {
      setResultat({ texte: 'Saisissez votre identifiant de connexion.', type: 'erreur' });
      return;
    }
    setEnvoi(true);
    try {
      const telephone = contact.trim() ? (normaliserTelephone(contact) ?? contact.trim()) : null;
      const r = await appeler<{ message: string }>('/aide/mot-de-passe-oublie', {
        methode: 'POST',
        corps: {
          identifiant: identifiant.trim(),
          contact: telephone,
          message: message.trim() || null,
        },
      });
      setResultat({ texte: r.message, type: 'succes' });
      setEnvoyee(true);
    } catch (e) {
      setResultat({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const ouvrir = (url: string) => {
    Linking.openURL(url).catch(() =>
      setResultat({ texte: 'Impossible d’ouvrir l’application sur cet appareil.', type: 'erreur' }),
    );
  };
  const chiffres = (numero: string) => numero.replace(/\D/g, '');
  const aucunContact =
    concepteur && !concepteur.telephone && !concepteur.whatsapp && !concepteur.email;

  return (
    <Ecran
      titre="Mot de passe oublié"
      sousTitre="Le concepteur vous donnera un nouveau mot de passe."
    >
      {!envoyee ? (
        <>
          <Champ
            libelle="Votre identifiant"
            value={identifiant}
            onChangeText={setIdentifiant}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
          />
          <Champ
            libelle="Votre numéro pour être rappelé (facultatif)"
            value={contact}
            onChangeText={setContact}
            keyboardType="phone-pad"
            placeholder="620 11 22 33"
          />
          <Champ
            libelle="Message (facultatif)"
            value={message}
            onChangeText={setMessage}
            placeholder="Nom de la boutique, précision…"
          />
          <Message texte={resultat?.texte ?? null} type={resultat?.type} />
          <Bouton
            titre="Envoyer la demande au concepteur"
            icone="send"
            onPress={() => void envoyer()}
            chargement={envoi}
          />
        </>
      ) : (
        <Message texte={resultat?.texte ?? null} type={resultat?.type} />
      )}

      <Carte titre="Contacter le concepteur" icone="call">
        {concepteur?.nom ? <Texte gras>{concepteur.nom}</Texte> : null}
        {concepteur?.telephone ? (
          <Bouton
            titre={`Appeler ${concepteur.telephone}`}
            icone="call"
            variante="secondaire"
            onPress={() => ouvrir(`tel:${concepteur.telephone}`)}
          />
        ) : null}
        {concepteur?.whatsapp ? (
          <Bouton
            titre={`WhatsApp ${concepteur.whatsapp}`}
            icone="logo-whatsapp"
            variante="secondaire"
            onPress={() =>
              ouvrir(
                `https://wa.me/${chiffres(concepteur.whatsapp!)}?text=${encodeURIComponent(
                  `Bonjour, j’ai oublié mon mot de passe Gestion vente Phone (identifiant : ${identifiant.trim()}).`,
                )}`,
              )
            }
          />
        ) : null}
        {concepteur?.email ? (
          <Bouton
            titre={concepteur.email}
            icone="mail"
            variante="secondaire"
            onPress={() =>
              ouvrir(
                `mailto:${concepteur.email}?subject=${encodeURIComponent('Mot de passe oublié')}`,
              )
            }
          />
        ) : null}
        {!concepteur || aucunContact ? (
          <Texte discret>
            Contact du concepteur indisponible pour le moment : votre demande lui parvient tout de
            même.
          </Texte>
        ) : null}
        <Texte discret>
          Vous êtes employé ? Votre propriétaire peut aussi vous donner un nouveau mot de passe
          (Menu → Équipe).
        </Texte>
      </Carte>

      <Bouton
        titre="Retour à la connexion"
        icone="arrow-back"
        variante="secondaire"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/connexion'))}
      />
    </Ecran>
  );
}
