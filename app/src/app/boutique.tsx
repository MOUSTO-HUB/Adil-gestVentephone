import { Bouton, Ecran, Message, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';

/** Choix de la boutique de travail quand l'utilisateur en a plusieurs. */
export default function ChoixBoutique() {
  const { profil, choisirBoutique, deconnexion } = useSession();
  const boutiques = profil?.boutiques ?? [];

  return (
    <Ecran titre="Dans quelle boutique travaillez-vous ?" sousTitre={profil?.commerce.nom}>
      {boutiques.length === 0 ? (
        <Message texte="Vous n'êtes rattaché à aucune boutique. Adressez-vous au propriétaire." />
      ) : (
        boutiques.map((b) => (
          <Bouton
            key={b.id}
            titre={b.nom}
            variante="secondaire"
            onPress={() => void choisirBoutique(b)}
          />
        ))
      )}
      {boutiques.length > 0 ? (
        <Texte discret>Vous pourrez changer de boutique depuis l’accueil.</Texte>
      ) : null}
      <Bouton titre="Se déconnecter" variante="secondaire" onPress={() => void deconnexion()} />
    </Ecran>
  );
}
