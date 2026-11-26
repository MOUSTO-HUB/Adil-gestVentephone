import { router } from 'expo-router';
import { useState } from 'react';
import { AutorisationAppareil } from '@/components/autorisation-appareil';
import { Bouton, Champ, Ecran, Message } from '@/components/ui';
import { ErreurApi, messageErreur } from '@/lib/api';
import { codeAppareilDemande } from '@/lib/cle-appareil';
import { useSession } from '@/lib/session';

export default function Connexion() {
  const { connexion } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  // Appareil pas encore autorisé pour ce compte : le code d'autorisation est demandé.
  const [codeDemande, setCodeDemande] = useState(false);
  const [codeAppareil, setCodeAppareil] = useState('');

  const valider = async () => {
    if (!identifiant.trim() || !motDePasse.trim()) {
      setErreur('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    if (codeDemande && !codeAppareil.trim()) {
      setErreur('Saisissez le code d’autorisation de cet appareil.');
      setEnvoi(false);
      return;
    }
    try {
      await connexion(
        identifiant.trim(),
        motDePasse.trim(),
        codeDemande ? codeAppareil : undefined,
      );
    } catch (e) {
      if (e instanceof ErreurApi && codeAppareilDemande(e.code)) setCodeDemande(true);
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  };

  return (
    <Ecran titre="Connexion" sousTitre="Connectez-vous avec le compte donné par le propriétaire.">
      <Champ
        libelle="Identifiant"
        value={identifiant}
        onChangeText={setIdentifiant}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
      />
      <Champ
        libelle="Mot de passe"
        value={motDePasse}
        onChangeText={setMotDePasse}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={valider}
      />
      {codeDemande ? (
        <AutorisationAppareil
          code={codeAppareil}
          surCode={setCodeAppareil}
          qui="votre propriétaire (Menu › Appareils autorisés) ou au service GestVente"
        />
      ) : null}
      <Message texte={erreur} />
      <Bouton
        titre={codeDemande ? 'Autoriser cet appareil et se connecter' : 'Se connecter'}
        onPress={valider}
        chargement={envoi}
      />
      <Bouton
        titre="Mot de passe oublié ?"
        icone="help-circle"
        variante="secondaire"
        onPress={() =>
          router.push({
            pathname: '/mot-de-passe-oublie',
            params: identifiant.trim() ? { identifiant: identifiant.trim() } : {},
          })
        }
      />
    </Ecran>
  );
}
