import { useState } from 'react';
import { Bouton, Champ, Ecran, Message } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function Connexion() {
  const { connexion } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valider = async () => {
    if (!identifiant.trim() || !motDePasse) {
      setErreur('Saisissez votre identifiant et votre mot de passe.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await connexion(identifiant, motDePasse);
    } catch (e) {
      setErreur(messageErreur(e));
      setEnvoi(false);
    }
  };

  return (
    <Ecran
      titre="GestVente Phone"
      sousTitre="Connectez-vous avec le compte donné par le propriétaire."
    >
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
      <Message texte={erreur} />
      <Bouton titre="Se connecter" onPress={valider} chargement={envoi} />
    </Ecran>
  );
}
