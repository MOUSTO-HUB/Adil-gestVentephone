import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AppareilsAutorises,
  type CodeCree,
  type ListeAppareils,
} from '@/components/appareils-autorises';
import { Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { usePlateforme } from '@/lib/plateforme';

/**
 * Espace concepteur : appareils autorisés des concepteurs (sans paramètre) ou de tous les
 * comptes d'un commerce (`commerceId`). Nouvel appareil par code, ancien appareil retiré.
 */
export default function AppareilsPlateforme() {
  const { commerceId, nom } = useLocalSearchParams<{ commerceId?: string; nom?: string }>();
  const { requete } = usePlateforme();
  const [donnees, setDonnees] = useState<ListeAppareils | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    requete<ListeAppareils>(`/appareils${commerceId ? `?commerceId=${commerceId}` : ''}`).then(
      (r) => {
        setDonnees(r);
        setErreur(null);
      },
      (e: unknown) => setErreur(messageErreur(e)),
    );
  }, [requete, commerceId]);
  useEffect(() => charger(), [charger]);

  return (
    <Ecran
      enHaut
      titre="Appareils autorisés"
      sousTitre={commerceId ? (nom ?? 'Commerce') : 'Comptes concepteur'}
    >
      <Texte discret>
        {commerceId
          ? 'Le commerçant ou un employé change d’appareil : créez-lui un code d’autorisation (il le saisit à la connexion) et retirez l’ancien appareil.'
          : 'Un concepteur change d’appareil : un autre concepteur lui crée un code d’autorisation (à saisir à la connexion) et retire l’ancien appareil.'}
      </Texte>
      <Message texte={erreur} />
      {donnees ? (
        <AppareilsAutorises
          donnees={donnees}
          apresChangement={charger}
          creerCode={(id, remplacer) =>
            requete<CodeCree>(
              `/${commerceId ? 'utilisateurs' : 'concepteurs'}/${id}/code-appareil`,
              { methode: 'POST', corps: { remplacer } },
            )
          }
          revoquer={(id) => requete<void>(`/appareils/${id}/revocation`, { methode: 'POST' })}
        />
      ) : null}
    </Ecran>
  );
}
