import { useCallback, useEffect, useState } from 'react';
import {
  AppareilsAutorises,
  type CodeCree,
  type ListeAppareils,
} from '@/components/appareils-autorises';
import { Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Appareils autorisés de l'équipe (en ligne) : le propriétaire gère ceux de tous ses
 * employés, un gérant ceux des vendeurs de ses boutiques. Nouvel appareil par code
 * d'autorisation, ancien appareil retiré.
 */
export default function AppareilsAutorisesEquipe() {
  const { api, profil } = useSession();
  const [donnees, setDonnees] = useState<ListeAppareils | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    api.requete<ListeAppareils>('/appareils/autorises').then(
      (r) => {
        setDonnees(r);
        setErreur(null);
      },
      (e: unknown) => setErreur(messageErreur(e)),
    );
  }, [api]);
  useEffect(() => charger(), [charger]);

  return (
    <Ecran titre="Appareils autorisés" sousTitre="Ordinateurs, téléphones et tablettes" enHaut>
      <Texte discret>
        Chaque compte ne se connecte que depuis ses appareils autorisés. Nouveau téléphone ou
        ordinateur : créez un code d’autorisation et donnez-le à la personne ; elle le saisit à la
        connexion. Appareil perdu, volé ou remplacé : retirez-le.
      </Texte>
      <Message texte={erreur} />
      {donnees ? (
        <AppareilsAutorises
          donnees={donnees}
          idCourant={profil?.id}
          apresChangement={charger}
          creerCode={(id, remplacer) =>
            api.requete<CodeCree>(`/utilisateurs/${id}/code-appareil`, {
              methode: 'POST',
              corps: { remplacer },
            })
          }
          revoquer={(id) =>
            api.requete<void>(`/appareils/autorises/${id}/revocation`, { methode: 'POST' })
          }
        />
      ) : null}
    </Ecran>
  );
}
