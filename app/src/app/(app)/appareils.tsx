import { LIBELLES_ROLES, type Role } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';

interface Appareil {
  id: string;
  nom: string;
  plateforme: string;
  dernierAcces: string | null;
  courant: boolean;
  utilisateur: { id: string; nom: string; role: Role };
}

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
    : 'jamais';

/** Propriétaire et gérants : appareils connectés et déconnexion à distance (appareil perdu, employé parti). */
export default function Appareils() {
  const { api } = useSession();
  const [appareils, setAppareils] = useState<Appareil[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  // Incrémenté pour recharger la liste.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let actif = true;
    api
      .requete<Appareil[]>('/appareils')
      .then((liste) => {
        if (!actif) return;
        setAppareils(liste);
        setErreur(null);
      })
      .catch((e: unknown) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, [api, version]);

  const deconnecter = async (appareil: Appareil) => {
    if (
      !(await confirmer(
        `Déconnecter « ${appareil.nom} » de ${appareil.utilisateur.nom} ?`,
        'Déconnecter',
      ))
    )
      return;
    setEnCours(appareil.id);
    try {
      await api.requete(`/appareils/${appareil.id}/deconnexion`, { methode: 'POST' });
      setVersion((v) => v + 1);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <Ecran
      enHaut
      titre="Appareils connectés"
      sousTitre="Déconnectez un appareil perdu, volé ou d’un employé parti."
    >
      <Message texte={erreur} />
      {appareils?.length === 0 ? <Texte discret>Aucun appareil connecté.</Texte> : null}
      {appareils?.map((a) => (
        <Carte key={a.id}>
          <Texte gras>
            {a.nom}
            {a.courant ? ' (cet appareil)' : ''}
          </Texte>
          <Texte discret>
            {a.utilisateur.nom} · {LIBELLES_ROLES[a.utilisateur.role]} · {a.plateforme}
          </Texte>
          <Texte discret>Dernière activité : {formatDate(a.dernierAcces)}</Texte>
          {a.courant ? null : (
            <Bouton
              titre="Déconnecter"
              variante="danger"
              chargement={enCours === a.id}
              onPress={() => void deconnecter(a)}
            />
          )}
        </Carte>
      ))}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
