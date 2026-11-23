import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import { usePlateforme } from '@/lib/plateforme';
import { useCouleurs } from '@/lib/theme';

interface CompteConcepteur {
  id: string;
  nom: string;
  identifiant: string;
  actif: boolean;
  doubleAuth: boolean;
  doitChangerMotDePasse: boolean;
  derniereConnexion: string | null;
  creeLe: string;
  moi: boolean;
}

/** Mot de passe provisoire à transmettre : affiché une seule fois. */
interface Provisoire {
  nom: string;
  identifiant: string;
  motDePasse: string;
}

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'jamais';

/**
 * Comptes des concepteurs : créer un compte, aider un collègue à se reconnecter (mot de
 * passe provisoire, double authentification retirée), désactiver ou supprimer un compte.
 * Supprimer un compte ne supprime rien de ce qu'il a créé (commerces, abonnements…).
 */
export default function Concepteurs() {
  const { requete } = usePlateforme();
  const [comptes, setComptes] = useState<CompteConcepteur[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [provisoire, setProvisoire] = useState<Provisoire | null>(null);

  const charger = useCallback(() => {
    requete<CompteConcepteur[]>('/concepteurs')
      .then(setComptes)
      .catch((e: unknown) => setErreur(messageErreur(e)));
  }, [requete]);
  useEffect(charger, [charger]);

  const action = async (travail: () => Promise<void>) => {
    setErreur(null);
    try {
      await travail();
      charger();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  return (
    <Ecran
      enHaut
      large
      retour={false}
      titre="Comptes concepteur"
      sousTitre="Qui gère la plateforme"
    >
      <Bouton
        titre="Mon compte : mot de passe et double authentification"
        icone="person-circle"
        variante="secondaire"
        onPress={() => router.push('/plateforme/compte')}
      />
      {provisoire ? (
        <Carte titre="Mot de passe provisoire" icone="key">
          <Texte>
            {provisoire.nom} ({provisoire.identifiant}) se connecte avec ce mot de passe, puis en
            choisit un nouveau :
          </Texte>
          <Texte gras>{provisoire.motDePasse}</Texte>
          <Message
            type="info"
            texte="Il n’est affiché qu’une fois : transmettez-le en main propre ou par appel, jamais dans un groupe."
          />
          <Bouton titre="C’est noté" variante="secondaire" onPress={() => setProvisoire(null)} />
        </Carte>
      ) : null}
      <Message texte={erreur} />
      <NouveauConcepteur surCree={(p) => void action(async () => setProvisoire(p))} />

      {(comptes ?? []).map((compte) => (
        <FicheCompte
          key={compte.id}
          compte={compte}
          surAide={(retirerDoubleAuth) =>
            void action(async () => {
              const r = await requete<{ identifiant: string; motDePasseProvisoire: string }>(
                `/concepteurs/${compte.id}/recuperation`,
                { methode: 'POST', corps: { retirerDoubleAuth } },
              );
              setProvisoire({
                nom: compte.nom,
                identifiant: r.identifiant,
                motDePasse: r.motDePasseProvisoire,
              });
            })
          }
          surActivation={() =>
            void action(async () => {
              if (
                compte.actif &&
                !(await confirmer(
                  `Désactiver le compte de ${compte.nom} ? Il ne pourra plus se connecter (réactivable).`,
                  'Désactiver',
                ))
              )
                return;
              await requete(`/concepteurs/${compte.id}`, {
                methode: 'PATCH',
                corps: { actif: !compte.actif },
              });
            })
          }
          surSuppression={() =>
            void action(async () => {
              if (
                !(await confirmer(
                  `Supprimer le compte de ${compte.nom} ? Il ne pourra plus se connecter. Les commerces et tout ce qu’il a créé sont gardés.`,
                  'Supprimer le compte',
                ))
              )
                return;
              await requete(`/concepteurs/${compte.id}`, { methode: 'DELETE' });
            })
          }
        />
      ))}
    </Ecran>
  );
}

function NouveauConcepteur({ surCree }: { surCree: (p: Provisoire) => void }) {
  const { requete } = usePlateforme();
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState('');
  const [identifiant, setIdentifiant] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  if (!ouvert) {
    return <Bouton titre="Nouveau concepteur" icone="person-add" onPress={() => setOuvert(true)} />;
  }
  const creer = async () => {
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await requete<{ identifiant: string; motDePasseProvisoire: string }>(
        '/concepteurs',
        { methode: 'POST', corps: { nom: nom.trim(), identifiant: identifiant.trim() } },
      );
      surCree({ nom: nom.trim(), identifiant: r.identifiant, motDePasse: r.motDePasseProvisoire });
      setNom('');
      setIdentifiant('');
      setOuvert(false);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Carte titre="Nouveau concepteur" icone="person-add">
      <Champ libelle="Nom et prénom" value={nom} onChangeText={setNom} />
      <Champ
        libelle="Identifiant de connexion (lettres, chiffres, . _ -)"
        value={identifiant}
        onChangeText={setIdentifiant}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Message texte={erreur} />
      <Bouton
        titre="Créer le compte"
        icone="checkmark"
        chargement={envoi}
        onPress={() => void creer()}
      />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => setOuvert(false)} />
    </Carte>
  );
}

function FicheCompte({
  compte,
  surAide,
  surActivation,
  surSuppression,
}: {
  compte: CompteConcepteur;
  surAide: (retirerDoubleAuth: boolean) => void;
  surActivation: () => void;
  surSuppression: () => void;
}) {
  const c = useCouleurs();
  return (
    <Carte>
      <View style={styles.ligne}>
        <Ionicons
          name="person-circle"
          size={34}
          color={compte.actif ? c.primaire : c.texteDiscret}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.nom, { color: c.texte }]}>
            {compte.nom}
            {compte.moi ? ' (vous)' : ''}
          </Text>
          <Texte discret>{compte.identifiant}</Texte>
        </View>
      </View>
      <View style={styles.etiquettes}>
        <Etiquette
          texte={compte.actif ? 'Actif' : 'Désactivé'}
          couleur={compte.actif ? c.succes : c.danger}
        />
        <Etiquette
          texte={compte.doubleAuth ? 'Double authentification' : 'Sans double authentification'}
          couleur={compte.doubleAuth ? c.succes : c.alerte}
        />
        {compte.doitChangerMotDePasse ? (
          <Etiquette texte="Mot de passe provisoire" couleur={c.alerte} />
        ) : null}
      </View>
      <Texte discret>Dernière connexion : {date(compte.derniereConnexion)}</Texte>
      {compte.moi ? null : (
        <>
          <Bouton
            titre="Aider à se reconnecter (nouveau mot de passe)"
            icone="key"
            variante="secondaire"
            onPress={() => surAide(false)}
          />
          {compte.doubleAuth ? (
            <Bouton
              titre="Téléphone perdu : nouveau mot de passe et double authentification retirée"
              icone="phone-portrait"
              variante="secondaire"
              onPress={() => surAide(true)}
            />
          ) : null}
          <Bouton
            titre={compte.actif ? 'Désactiver' : 'Réactiver'}
            icone={compte.actif ? 'pause-circle' : 'play-circle'}
            variante="secondaire"
            onPress={surActivation}
          />
          <Bouton
            titre="Supprimer le compte"
            icone="trash"
            variante="danger"
            onPress={surSuppression}
          />
        </>
      )}
    </Carte>
  );
}

function Etiquette({ texte, couleur }: { texte: string; couleur: string }) {
  return (
    <View style={[styles.etiquette, { borderColor: couleur }]}>
      <Text style={{ color: couleur, fontSize: 13, fontWeight: '700' }}>{texte}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nom: { fontSize: 17, fontWeight: '700' },
  etiquettes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  etiquette: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
});
