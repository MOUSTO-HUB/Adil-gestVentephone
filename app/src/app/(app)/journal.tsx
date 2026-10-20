import { FAMILLES_AUDIT, LIBELLES_ACTIONS_AUDIT } from '@gestvente/commun';
import { useEffect, useState } from 'react';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { ErreurReseau, messageErreur } from '@/lib/api';
import { bornes, type CodePeriode, PERIODES } from '@/lib/rapports';
import { useSession } from '@/lib/session';

interface Entree {
  id: string;
  creeLe: string;
  action: string;
  utilisateur: string | null;
  boutique: string | null;
  entite: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
}

const TOUTES = 'toutes';
const FAMILLES = [
  { id: TOUTES, nom: 'Toutes' },
  ...Object.keys(FAMILLES_AUDIT).map((nom) => ({ id: nom, nom })),
];

/** Détails lisibles (montants, motifs, avant/après) sans tout le JSON. */
function resume(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 6)
    .map(([cle, v]) => `${cle} : ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 300);
}

/**
 * Journal d'audit (propriétaire et gérants) : connexions, remises, prix, annulations,
 * stock, caisse. Filtres par utilisateur, boutique, famille d'actions et période.
 */
export default function Journal() {
  const { profil, api } = useSession();
  const [periode, setPeriode] = useState<CodePeriode>('semaine');
  const [famille, setFamille] = useState(TOUTES);
  const [utilisateurId, setUtilisateurId] = useState(TOUTES);
  const [boutiqueId, setBoutiqueId] = useState(TOUTES);
  const [utilisateurs, setUtilisateurs] = useState<{ id: string; nom: string }[]>([]);
  const [entrees, setEntrees] = useState<Entree[]>([]);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);

  const { du, au } = bornes(periode);
  const filtres = new URLSearchParams({ du: du.toISOString(), au: au.toISOString(), limite: '50' });
  if (famille !== TOUTES) filtres.set('actions', (FAMILLES_AUDIT[famille] ?? []).join(','));
  if (utilisateurId !== TOUTES) filtres.set('utilisateurId', utilisateurId);
  if (boutiqueId !== TOUTES) filtres.set('boutiqueId', boutiqueId);
  const requete = filtres.toString();

  useEffect(() => {
    let actif = true;
    api
      .requete<{ id: string; nom: string }[]>('/audit/utilisateurs')
      .then((u) => actif && setUtilisateurs(u))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [api]);

  useEffect(() => {
    let actif = true;
    api
      .requete<{ entrees: Entree[]; suivant: string | null }>(`/audit?${requete}`)
      .then((r) => {
        if (!actif) return;
        setEntrees(r.entrees);
        setSuivant(r.suivant);
        setMessage(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setEntrees([]);
        setMessage(
          e instanceof ErreurReseau ? 'Le journal se consulte en ligne.' : messageErreur(e),
        );
      });
    return () => {
      actif = false;
    };
  }, [api, requete]);

  const plus = async () => {
    if (!suivant) return;
    setChargement(true);
    try {
      const r = await api.requete<{ entrees: Entree[]; suivant: string | null }>(
        `/audit?${requete}&avant=${encodeURIComponent(suivant)}`,
      );
      setEntrees((e) => [...e, ...r.entrees]);
      setSuivant(r.suivant);
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setChargement(false);
    }
  };

  return (
    <Ecran titre="Journal d’audit" sousTitre={profil?.commerce.nom} enHaut>
      <Choix
        libelle="Période"
        options={PERIODES}
        valeurs={[periode]}
        surChoix={([p]) => p && setPeriode(p as CodePeriode)}
      />
      <Choix
        libelle="Opérations"
        options={FAMILLES}
        valeurs={[famille]}
        surChoix={([f]) => f && setFamille(f)}
      />
      <Choix
        libelle="Utilisateur"
        options={[{ id: TOUTES, nom: 'Tous' }, ...utilisateurs]}
        valeurs={[utilisateurId]}
        surChoix={([u]) => u && setUtilisateurId(u)}
      />
      {(profil?.boutiques.length ?? 0) > 1 ? (
        <Choix
          libelle="Boutique"
          options={[{ id: TOUTES, nom: 'Toutes' }, ...(profil?.boutiques ?? [])]}
          valeurs={[boutiqueId]}
          surChoix={([b]) => b && setBoutiqueId(b)}
        />
      ) : null}
      <Message texte={message} />
      {!message && entrees.length === 0 ? (
        <Texte discret>Aucune opération sur cette période.</Texte>
      ) : null}
      {entrees.map((e) => (
        <Carte key={e.id}>
          <Texte gras>{LIBELLES_ACTIONS_AUDIT[e.action] ?? e.action}</Texte>
          <Texte discret>
            {new Date(e.creeLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
            {e.utilisateur ? ` · ${e.utilisateur}` : ''}
            {e.boutique ? ` · ${e.boutique}` : ''}
            {e.ip ? ` · ${e.ip}` : ''}
          </Texte>
          {e.details ? <Texte discret>{resume(e.details)}</Texte> : null}
        </Carte>
      ))}
      {suivant ? (
        <Bouton
          titre="Voir plus"
          variante="secondaire"
          chargement={chargement}
          onPress={() => void plus()}
        />
      ) : null}
    </Ecran>
  );
}
