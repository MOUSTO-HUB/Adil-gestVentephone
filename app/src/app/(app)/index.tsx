import { LIBELLES_ROLES, peutGererSessions } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Bouton, Carte, Ecran, Texte } from '@/components/ui';
import { ErreurReseau } from '@/lib/api';
import { useSession } from '@/lib/session';

type EtatServeur = 'verification' | 'joignable' | 'injoignable';

const LIBELLES_SERVEUR: Record<EtatServeur, string> = {
  verification: 'Vérification du serveur…',
  joignable: 'En ligne',
  injoignable: 'Hors ligne',
};

/** Accueil provisoire : la caisse et le stock viendront aux étapes suivantes. */
export default function Accueil() {
  const { profil, boutique, choisirBoutique, verrouiller, deconnexion, rafraichirProfil } =
    useSession();
  const [serveur, setServeur] = useState<EtatServeur>('verification');

  useEffect(() => {
    rafraichirProfil()
      .then((enLigne) => setServeur(enLigne ? 'joignable' : 'injoignable'))
      .catch((e: unknown) => setServeur(e instanceof ErreurReseau ? 'injoignable' : 'joignable'));
  }, [rafraichirProfil]);

  if (!profil || !boutique) return null;

  return (
    <Ecran titre={boutique.nom} sousTitre={profil.commerce.nom}>
      <Carte>
        <Texte gras>{profil.nom}</Texte>
        <Texte discret>{LIBELLES_ROLES[profil.role]}</Texte>
        <Texte discret>Serveur : {LIBELLES_SERVEUR[serveur]}</Texte>
      </Carte>
      {profil.boutiques.length > 1 ? (
        <Bouton
          titre="Changer de boutique"
          variante="secondaire"
          onPress={() => void choisirBoutique(null)}
        />
      ) : null}
      {peutGererSessions(profil.role) ? (
        <Bouton
          titre="Appareils connectés"
          variante="secondaire"
          onPress={() => router.push('/appareils')}
        />
      ) : null}
      <Bouton titre="Verrouiller" variante="secondaire" onPress={verrouiller} />
      <Bouton titre="Se déconnecter" variante="danger" onPress={() => void deconnexion()} />
    </Ecran>
  );
}
