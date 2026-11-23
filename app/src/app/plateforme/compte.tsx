import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { usePlateforme } from '@/lib/plateforme';
import { useCouleurs } from '@/lib/theme';

interface MonCompte {
  nom: string;
  identifiant: string;
  doubleAuth: boolean;
  doitChangerMotDePasse: boolean;
}

interface Preparation {
  secret: string;
  adresse: string;
  qrCode: string;
}

type Retour = { texte: string; type: 'erreur' | 'succes' } | null;

/** Mon compte (concepteur) : changer son mot de passe, double authentification par application. */
export default function CompteConcepteur() {
  const { requete, majSession } = usePlateforme();
  const [compte, setCompte] = useState<MonCompte | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    requete<MonCompte>('/moi')
      .then(setCompte)
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [requete]);
  useEffect(charger, [charger]);

  return (
    <Ecran
      enHaut
      titre="Mon compte"
      sousTitre={compte ? `${compte.nom} (${compte.identifiant})` : undefined}
      retour={!compte?.doitChangerMotDePasse}
    >
      <Message texte={erreur} />
      {compte ? (
        <>
          {compte.doitChangerMotDePasse ? (
            <Message texte="Vous utilisez un mot de passe provisoire : choisissez le vôtre pour continuer." />
          ) : null}
          <ChangerMotDePasse
            surSucces={async () => {
              await majSession({ doitChangerMotDePasse: false });
              if (compte.doitChangerMotDePasse) router.replace('/plateforme');
              else charger();
            }}
          />
          {compte.doitChangerMotDePasse ? null : (
            <DoubleAuth
              active={compte.doubleAuth}
              surChangement={async (active) => {
                await majSession({ doubleAuth: active });
                charger();
              }}
            />
          )}
        </>
      ) : null}
    </Ecran>
  );
}

function ChangerMotDePasse({ surSucces }: { surSucces: () => Promise<void> }) {
  const { requete } = usePlateforme();
  const [actuel, setActuel] = useState('');
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);

  const enregistrer = async () => {
    setRetour(null);
    if (nouveau.trim() !== confirmation.trim()) {
      setRetour({
        texte: 'Les deux nouveaux mots de passe ne sont pas identiques.',
        type: 'erreur',
      });
      return;
    }
    setEnvoi(true);
    try {
      await requete('/moi/mot-de-passe', {
        methode: 'PUT',
        corps: { actuel: actuel.trim(), nouveau: nouveau.trim() },
      });
      setActuel('');
      setNouveau('');
      setConfirmation('');
      setRetour({ texte: 'Mot de passe changé.', type: 'succes' });
      await surSucces();
    } catch (e) {
      setRetour({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Carte titre="Changer mon mot de passe" icone="key">
      <Champ
        libelle="Mot de passe actuel (ou provisoire)"
        value={actuel}
        onChangeText={setActuel}
        secureTextEntry
        autoComplete="current-password"
      />
      <Champ
        libelle="Nouveau mot de passe (10 caractères, lettres et chiffres)"
        value={nouveau}
        onChangeText={setNouveau}
        secureTextEntry
        autoComplete="new-password"
      />
      <Champ
        libelle="Nouveau mot de passe, encore une fois"
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        autoComplete="new-password"
        onSubmitEditing={() => void enregistrer()}
      />
      <Message texte={retour?.texte ?? null} type={retour?.type} />
      <Bouton
        titre="Enregistrer le mot de passe"
        icone="save"
        chargement={envoi}
        onPress={() => void enregistrer()}
      />
    </Carte>
  );
}

function DoubleAuth({
  active,
  surChangement,
}: {
  active: boolean;
  surChangement: (active: boolean) => Promise<void>;
}) {
  const c = useCouleurs();
  const { requete } = usePlateforme();
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [code, setCode] = useState('');
  const [retour, setRetour] = useState<Retour>(null);
  const [envoi, setEnvoi] = useState(false);

  const executer = async (action: () => Promise<void>) => {
    setRetour(null);
    setEnvoi(true);
    try {
      await action();
    } catch (e) {
      setRetour({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const champCode = (
    <Champ
      libelle="Code à 6 chiffres de l’application"
      value={code}
      onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
      keyboardType="number-pad"
      autoComplete="one-time-code"
    />
  );

  if (active) {
    return (
      <Carte titre="Double authentification : active" icone="shield-checkmark">
        <Texte>
          À chaque connexion, le code de Google Authenticator est demandé après le mot de passe.
        </Texte>
        <Texte discret>
          Pour la retirer (changement de téléphone), saisissez le code actuel de l’application.
        </Texte>
        {champCode}
        <Message texte={retour?.texte ?? null} type={retour?.type} />
        <Bouton
          titre="Retirer la double authentification"
          variante="danger"
          icone="close-circle"
          chargement={envoi}
          onPress={() =>
            void executer(async () => {
              await requete('/moi/double-auth/desactiver', { methode: 'POST', corps: { code } });
              setCode('');
              await surChangement(false);
            })
          }
        />
      </Carte>
    );
  }

  return (
    <Carte titre="Double authentification" icone="shield">
      <Texte>
        Protégez votre compte : en plus du mot de passe, un code à 6 chiffres donné par une
        application sur votre téléphone (Google Authenticator, Microsoft Authenticator…).
      </Texte>
      {!preparation ? (
        <>
          <Message texte={retour?.texte ?? null} type={retour?.type} />
          <Bouton
            titre="Activer la double authentification"
            icone="shield-checkmark"
            chargement={envoi}
            onPress={() =>
              void executer(async () => {
                setPreparation(
                  await requete<Preparation>('/moi/double-auth/preparer', { methode: 'POST' }),
                );
              })
            }
          />
        </>
      ) : (
        <>
          <Texte gras>1. Installez Google Authenticator sur votre téléphone.</Texte>
          <Texte gras>2. Dans l’application, touchez « + », puis « Scanner un code QR » :</Texte>
          <View style={[styles.qr, { borderColor: c.bordure }]}>
            <Image
              source={{ uri: preparation.qrCode }}
              style={styles.imageQr}
              accessibilityLabel="Code QR à scanner avec l’application d’authentification"
            />
          </View>
          <Texte discret>
            Impossible de scanner ? Choisissez « Saisir une clé de configuration » et tapez :
          </Texte>
          <Texte gras>{preparation.secret}</Texte>
          <Texte gras>
            3. Saisissez le code à 6 chiffres affiché pour « Gestion vente Phone » :
          </Texte>
          {champCode}
          <Message texte={retour?.texte ?? null} type={retour?.type} />
          <Bouton
            titre="Confirmer et activer"
            icone="checkmark-circle"
            chargement={envoi}
            onPress={() =>
              void executer(async () => {
                await requete('/moi/double-auth/activer', { methode: 'POST', corps: { code } });
                setPreparation(null);
                setCode('');
                await surChangement(true);
              })
            }
          />
          <Bouton
            titre="Annuler"
            variante="secondaire"
            onPress={() => {
              setPreparation(null);
              setCode('');
            }}
          />
        </>
      )}
    </Carte>
  );
}

const styles = StyleSheet.create({
  qr: {
    alignSelf: 'center',
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  imageQr: { width: 220, height: 220 },
});
