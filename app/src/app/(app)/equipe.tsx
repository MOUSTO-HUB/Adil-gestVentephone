import { LIBELLES_ROLES, normaliserTelephone, type Role } from '@gestvente/commun';
import { useCallback, useEffect, useState } from 'react';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';

interface Employe {
  id: string;
  nom: string;
  identifiant: string;
  telephone: string | null;
  role: Role;
  actif: boolean;
  boutiqueIds: string[];
  appareils: number;
  derniereConnexion: string | null;
}

type RoleEmploye = 'GERANT' | 'VENDEUR';
const ROLES_EMPLOYE = [
  { id: 'VENDEUR', nom: 'Vendeur' },
  { id: 'GERANT', nom: 'Gérant' },
];

/**
 * Équipe du commerce : le propriétaire crée les comptes (mot de passe provisoire
 * affiché une fois), choisit le rôle et les boutiques de chacun, désactive un compte
 * (déconnecté de tous ses appareils). Le gérant consulte l'équipe de ses boutiques.
 */
export default function Equipe() {
  const { profil, api } = useSession();
  const [employes, setEmployes] = useState<Employe[] | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [acces, setAcces] = useState<{ identifiant: string; motDePasse: string } | null>(null);
  const [nouveau, setNouveau] = useState({
    nom: '',
    identifiant: '',
    telephone: '',
    role: 'VENDEUR' as RoleEmploye,
    boutiqueIds: [] as string[],
  });
  const [edition, setEdition] = useState<{
    id: string;
    role: RoleEmploye;
    boutiqueIds: string[];
  } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const proprietaire = profil?.role === 'PROPRIETAIRE';

  const charger = useCallback(
    () =>
      api.requete<Employe[]>('/employes').then(
        (liste) => setEmployes(liste),
        (e: unknown) => setMessage({ texte: messageErreur(e), type: 'erreur' }),
      ),
    [api],
  );
  useEffect(() => {
    void charger();
  }, [charger]);

  if (!profil)
    return (
      <Ecran titre="Équipe" enHaut>
        {null}
      </Ecran>
    );
  const boutiques = profil.boutiques.map((b) => ({ id: b.id, nom: b.nom }));
  const nomsBoutiques = (ids: string[]) =>
    ids.map((id) => boutiques.find((b) => b.id === id)?.nom ?? '—').join(', ');

  /** Appel à l'API, puis liste rechargée ; message de réussite ou d'erreur. */
  const agir = async <T,>(tache: () => Promise<T>, succes: (r: T) => string) => {
    setMessage(null);
    setEnvoi(true);
    try {
      const r = await tache();
      setMessage({ texte: succes(r), type: 'succes' });
      await charger();
      return r;
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
      return undefined;
    } finally {
      setEnvoi(false);
    }
  };

  const creer = async () => {
    const telephone = nouveau.telephone.trim()
      ? normaliserTelephone(nouveau.telephone, profil.commerce.indicatif)
      : undefined;
    if (telephone === null) return setMessage({ texte: 'Téléphone invalide.', type: 'erreur' });
    if (!nouveau.boutiqueIds.length) {
      return setMessage({ texte: 'Choisissez au moins une boutique.', type: 'erreur' });
    }
    const r = await agir(
      () =>
        api.requete<{ identifiant: string; motDePasse: string }>('/employes', {
          methode: 'POST',
          corps: { ...nouveau, nom: nouveau.nom.trim(), telephone },
        }),
      (x) => `Compte « ${x.identifiant} » créé.`,
    );
    if (r) {
      setAcces(r);
      setNouveau({ nom: '', identifiant: '', telephone: '', role: 'VENDEUR', boutiqueIds: [] });
    }
  };

  const modifier = (id: string, corps: object, succes: string) =>
    agir(
      () => api.requete(`/employes/${id}`, { methode: 'PATCH', corps }),
      () => succes,
    );

  const reinitialiser = async (e: Employe) => {
    if (
      !(await confirmer(`Nouveau mot de passe pour ${e.nom} ? Ses appareils seront déconnectés.`))
    )
      return;
    const r = await agir(
      () =>
        api.requete<{ identifiant: string; motDePasse: string }>(`/employes/${e.id}/mot-de-passe`, {
          methode: 'POST',
        }),
      () => `Nouveau mot de passe créé pour ${e.nom}.`,
    );
    if (r) setAcces(r);
  };

  const basculerActif = async (e: Employe) => {
    if (
      e.actif &&
      !(await confirmer(`Désactiver ${e.nom} ? Il sera déconnecté de tous ses appareils.`))
    )
      return;
    await modifier(
      e.id,
      { actif: !e.actif },
      e.actif ? `${e.nom} est désactivé.` : `${e.nom} est réactivé.`,
    );
  };

  return (
    <Ecran titre="Équipe" sousTitre={profil.commerce.nom} enHaut>
      {!proprietaire ? (
        <Message type="info" texte="Équipe de vos boutiques (gérée par le propriétaire)." />
      ) : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
      {acces ? (
        <Carte titre="Accès à transmettre" icone="key">
          <Texte>Identifiant : {acces.identifiant}</Texte>
          <Texte gras>Mot de passe provisoire : {acces.motDePasse}</Texte>
          <Texte discret>
            Affiché une seule fois. L’employé choisit son code PIN à sa première connexion.
          </Texte>
          <Bouton titre="C’est noté" variante="secondaire" onPress={() => setAcces(null)} />
        </Carte>
      ) : null}

      {employes?.map((e) => (
        <Carte
          key={e.id}
          titre={`${e.nom}${e.actif ? '' : ' (désactivé)'}`}
          icone={e.role === 'PROPRIETAIRE' ? 'star' : e.role === 'GERANT' ? 'ribbon' : 'person'}
        >
          <Texte discret>
            {e.identifiant} · {LIBELLES_ROLES[e.role]}
            {e.telephone ? ` · ${e.telephone}` : ''}
          </Texte>
          {e.role !== 'PROPRIETAIRE' ? (
            <Texte>Boutiques : {nomsBoutiques(e.boutiqueIds) || 'aucune'}</Texte>
          ) : (
            <Texte discret>Toutes les boutiques</Texte>
          )}
          <Texte discret>
            {e.appareils} appareil(s) connecté(s)
            {e.derniereConnexion
              ? ` · vu le ${new Date(e.derniereConnexion).toLocaleDateString('fr-FR')}`
              : ''}
          </Texte>
          {proprietaire && e.role !== 'PROPRIETAIRE' ? (
            edition?.id === e.id ? (
              <>
                <Choix
                  libelle="Rôle"
                  options={ROLES_EMPLOYE}
                  valeurs={[edition.role]}
                  surChoix={([v]) => v && setEdition({ ...edition, role: v as RoleEmploye })}
                />
                <Choix
                  libelle="Boutiques"
                  multiple
                  options={boutiques}
                  valeurs={edition.boutiqueIds}
                  surChoix={(ids) => setEdition({ ...edition, boutiqueIds: ids })}
                />
                <Bouton
                  titre="Enregistrer"
                  icone="save"
                  chargement={envoi}
                  onPress={() =>
                    void modifier(
                      e.id,
                      { role: edition.role, boutiqueIds: edition.boutiqueIds },
                      `${e.nom} : rôle et boutiques enregistrés.`,
                    ).then(() => setEdition(null))
                  }
                />
                <Bouton titre="Annuler" variante="secondaire" onPress={() => setEdition(null)} />
              </>
            ) : (
              <>
                <Bouton
                  titre="Rôle et boutiques"
                  icone="create-outline"
                  variante="secondaire"
                  onPress={() =>
                    setEdition({
                      id: e.id,
                      role: e.role as RoleEmploye,
                      boutiqueIds: e.boutiqueIds,
                    })
                  }
                />
                <Bouton
                  titre="Nouveau mot de passe"
                  icone="key-outline"
                  variante="secondaire"
                  onPress={() => void reinitialiser(e)}
                />
                <Bouton
                  titre={e.actif ? 'Désactiver le compte' : 'Réactiver le compte'}
                  icone={e.actif ? 'close-circle-outline' : 'checkmark-circle-outline'}
                  variante={e.actif ? 'danger' : 'secondaire'}
                  onPress={() => void basculerActif(e)}
                />
              </>
            )
          ) : null}
        </Carte>
      ))}

      {proprietaire ? (
        <Carte titre="Nouvel employé" icone="person-add">
          <Champ
            libelle="Nom complet"
            value={nouveau.nom}
            onChangeText={(nom) => setNouveau((n) => ({ ...n, nom }))}
          />
          <Champ
            libelle="Identifiant de connexion"
            value={nouveau.identifiant}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(identifiant) => setNouveau((n) => ({ ...n, identifiant }))}
          />
          <Champ
            libelle="Téléphone (facultatif)"
            value={nouveau.telephone}
            keyboardType="phone-pad"
            onChangeText={(telephone) => setNouveau((n) => ({ ...n, telephone }))}
          />
          <Choix
            libelle="Rôle"
            options={ROLES_EMPLOYE}
            valeurs={[nouveau.role]}
            surChoix={([v]) => v && setNouveau((n) => ({ ...n, role: v as RoleEmploye }))}
          />
          <Choix
            libelle="Boutiques"
            multiple
            options={boutiques}
            valeurs={nouveau.boutiqueIds}
            surChoix={(ids) => setNouveau((n) => ({ ...n, boutiqueIds: ids }))}
          />
          <Bouton
            titre="Créer le compte"
            icone="add"
            onPress={() => void creer()}
            chargement={envoi}
          />
        </Carte>
      ) : null}
    </Ecran>
  );
}
