import { LIBELLES_OPERATIONS, peutGererSessions, type TypeOperation } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface OperationLocale {
  id: string;
  type: TypeOperation;
  statut: 'EN_ATTENTE' | 'REJETEE' | 'CONFLIT';
  motif: string | null;
  faiteLe: string;
}

interface Conflit {
  id: string;
  libelle: string;
  motif: string | null;
  faiteLe: string;
  utilisateur: { nom: string } | null;
}

const LIBELLES_STATUT = { EN_ATTENTE: 'En attente', REJETEE: 'Refusée', CONFLIT: 'En conflit' };

const date = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Détail de la synchronisation : file locale, refus, conflits à traiter par le gérant. */
export default function Synchronisation() {
  const { profil, api } = useSession();
  const { etat, synchroniser, effacerRefusees, version } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const operations = useLecture(
    (base) =>
      base.tous<OperationLocale>(
        'SELECT id, type, statut, motif, faiteLe FROM operation ORDER BY ordre DESC LIMIT 100',
      ),
    [],
  );
  const [conflits, setConflits] = useState<Conflit[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    if (!gestion) return;
    let actif = true;
    api
      .requete<Conflit[]>('/sync/conflits')
      .then((liste) => actif && setConflits(liste))
      .catch((e: unknown) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, [api, gestion, version, rechargement]);

  const traiter = async (id: string) => {
    try {
      await api.requete(`/sync/conflits/${id}/traitement`, { methode: 'POST' });
      setRechargement((n) => n + 1);
      synchroniser();
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const refusees = operations?.filter((o) => o.statut !== 'EN_ATTENTE') ?? [];

  return (
    <Ecran titre="Synchronisation" enHaut>
      <Carte>
        <Texte gras>
          {etat.reseau === 'hors-ligne'
            ? 'Hors ligne'
            : etat.reseau === 'en-ligne'
              ? 'En ligne'
              : '…'}
        </Texte>
        <Texte discret>
          Dernière synchronisation : {etat.derniereSync ? date(etat.derniereSync) : 'jamais'}
        </Texte>
        <Texte discret>Opérations en attente d’envoi : {etat.enAttente}</Texte>
        {etat.erreur ? <Message texte={etat.erreur} /> : null}
      </Carte>
      <Bouton titre="Synchroniser maintenant" onPress={synchroniser} chargement={etat.enCours} />

      {operations?.length ? <Texte gras>Opérations de cet appareil</Texte> : null}
      {operations?.map((o) => (
        <Carte key={o.id}>
          <Texte gras>{LIBELLES_OPERATIONS[o.type] ?? o.type}</Texte>
          <Texte discret>
            {LIBELLES_STATUT[o.statut]} · {date(o.faiteLe)}
          </Texte>
          {o.motif ? <Message texte={o.motif} /> : null}
        </Carte>
      ))}
      {refusees.length > 0 ? (
        <Bouton
          titre="J’ai pris connaissance des refus"
          variante="secondaire"
          onPress={() => void effacerRefusees()}
        />
      ) : null}

      {gestion ? <Texte gras>Conflits à traiter</Texte> : null}
      <Message texte={erreur} />
      {gestion && conflits?.length === 0 ? <Texte discret>Aucun conflit.</Texte> : null}
      {conflits?.map((c) => (
        <Carte key={c.id}>
          <Texte gras>{c.libelle}</Texte>
          <Texte discret>
            {c.utilisateur?.nom ?? 'Inconnu'} · {date(c.faiteLe)}
          </Texte>
          {c.motif ? <Message texte={c.motif} /> : null}
          <Bouton
            titre="Marquer comme traité"
            variante="secondaire"
            onPress={() => void traiter(c.id)}
          />
        </Carte>
      ))}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
