import { erreurNouveauPin, PIN_LONGUEUR_MAX } from '@gestvente/commun';
import { useState } from 'react';
import { Bouton, Champ, Ecran, Message } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Trois cas : créer le code PIN (premier appareil), confirmer le code existant
 * (nouvel appareil, vérifié par le serveur) ou déverrouiller (vérifié hors ligne).
 */
export default function Pin() {
  const { statut, profil, etatPin, creerPin, confirmerPin, deverrouiller, deconnexion } =
    useSession();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const mode =
    statut === 'verrouille' ? 'deverrouiller' : profil?.pinDefini ? 'confirmer' : 'creer';

  const valider = async () => {
    setErreur(null);
    if (mode === 'creer') {
      const probleme =
        erreurNouveauPin(pin) ??
        (pin !== confirmation ? 'Les deux codes ne sont pas identiques.' : null);
      if (probleme) {
        setErreur(probleme);
        return;
      }
    }
    setEnvoi(true);
    try {
      if (mode === 'creer') await creerPin(pin);
      else if (mode === 'confirmer') {
        if (!(await confirmerPin(pin))) setErreur('Code PIN incorrect.');
      } else if (!(await deverrouiller(pin))) {
        const restants = etatPin.essaisRestants - 1;
        setErreur(
          restants > 0
            ? `Code PIN incorrect. Encore ${restants} essai${restants > 1 ? 's' : ''}.`
            : null,
        );
      }
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setPin('');
      setConfirmation('');
      setEnvoi(false);
    }
  };

  const textes = {
    creer: {
      titre: 'Choisissez un code PIN',
      sousTitre: 'De 4 à 6 chiffres. Il déverrouille l’application, même sans Internet.',
      bouton: 'Enregistrer le code',
    },
    confirmer: {
      titre: 'Votre code PIN',
      sousTitre: 'Saisissez le code PIN de votre compte pour utiliser cet appareil.',
      bouton: 'Valider',
    },
    deverrouiller: {
      titre: `Bonjour ${profil?.nom ?? ''}`.trim(),
      sousTitre: 'Saisissez votre code PIN pour déverrouiller.',
      bouton: 'Déverrouiller',
    },
  }[mode];

  return (
    <Ecran titre={textes.titre} sousTitre={textes.sousTitre}>
      <Champ
        libelle="Code PIN"
        value={pin}
        onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={PIN_LONGUEUR_MAX}
        autoFocus
        onSubmitEditing={mode === 'creer' ? undefined : valider}
      />
      {mode === 'creer' ? (
        <Champ
          libelle="Confirmez le code PIN"
          value={confirmation}
          onChangeText={(t) => setConfirmation(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_LONGUEUR_MAX}
          onSubmitEditing={valider}
        />
      ) : null}
      <Message texte={erreur} />
      <Bouton
        titre={textes.bouton}
        onPress={valider}
        chargement={envoi}
        desactive={pin.length < 4}
      />
      <Bouton
        titre="Changer d’utilisateur"
        variante="secondaire"
        onPress={() => void deconnexion()}
      />
    </Ecran>
  );
}
