import { LIBELLES_ROLES, type Role } from '@gestvente/commun';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { Bouton, Carte, Champ, Ecran, Message, Section, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { confirmer } from '@/lib/confirmer';
import { usePlateforme } from '@/lib/plateforme';

interface Demande {
  id: string;
  statut: 'EN_ATTENTE' | 'TRAITEE' | 'IGNOREE';
  creeLe: string;
  traiteLe: string | null;
  traitePar: string | null;
  contact: string | null;
  message: string | null;
  utilisateur: { nom: string; identifiant: string; role: Role; telephone: string | null } | null;
  commerce: { id: string; nom: string; statut: string } | null;
}

interface Contact {
  nom: string | null;
  telephone: string | null;
  whatsapp: string | null;
  email: string | null;
}

/** Mot de passe provisoire à transmettre : affiché une seule fois. */
interface Acces {
  nom: string;
  identifiant: string;
  motDePasse: string;
  contact: string | null;
}

const LIBELLES_STATUTS = {
  EN_ATTENTE: 'En attente',
  TRAITEE: 'Nouveau mot de passe donné',
  IGNOREE: 'Ignorée',
} as const;

const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Demandes « Mot de passe oublié » des commerçants : nouveau mot de passe provisoire
 * (affiché une fois, à transmettre par appel ou WhatsApp) ; contact affiché aux commerçants.
 */
export default function Demandes() {
  const { requete, rafraichirDemandes } = usePlateforme();
  const [demandes, setDemandes] = useState<Demande[] | null>(null);
  const [acces, setAcces] = useState<Acces | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const charger = useCallback(
    () =>
      requete<Demande[]>('/demandes').then(
        (r) => {
          setDemandes(r);
          setErreur(null);
        },
        (e: unknown) => setErreur(messageErreur(e)),
      ),
    [requete],
  );
  useEffect(() => {
    void charger();
  }, [charger]);

  const traiter = async (d: Demande, ignorer: boolean) => {
    const qui = d.utilisateur ? `${d.utilisateur.nom} (${d.utilisateur.identifiant})` : 'ce compte';
    if (
      !(await confirmer(
        ignorer
          ? `Ignorer la demande de ${qui} ?`
          : `Créer un nouveau mot de passe provisoire pour ${qui} ? L’ancien ne marchera plus.`,
        ignorer ? 'Ignorer' : 'Créer le mot de passe',
      ))
    ) {
      return;
    }
    setErreur(null);
    setEnCours(d.id);
    try {
      if (ignorer) {
        await requete(`/demandes/${d.id}/ignorer`, { methode: 'POST' });
      } else {
        setAcces(await requete<Acces>(`/demandes/${d.id}/mot-de-passe`, { methode: 'POST' }));
      }
      await charger();
      rafraichirDemandes();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  const envoyerWhatsapp = (a: Acces) => {
    const numero = (a.contact ?? '').replace(/\D/g, '');
    const texte = `Bonjour ${a.nom}, voici votre nouveau mot de passe Gestion vente Phone.\nIdentifiant : ${a.identifiant}\nMot de passe : ${a.motDePasse}\nGardez-le pour vous.`;
    void Linking.openURL(`https://wa.me/${numero}?text=${encodeURIComponent(texte)}`).catch(() =>
      setErreur('WhatsApp n’a pas pu être ouvert.'),
    );
  };

  const enAttente = (demandes ?? []).filter((d) => d.statut === 'EN_ATTENTE');
  const traitees = (demandes ?? []).filter((d) => d.statut !== 'EN_ATTENTE');

  return (
    <Ecran enHaut titre="Mots de passe oubliés" sousTitre="Demandes des commerçants">
      {acces ? (
        <Carte titre="Nouveau mot de passe" icone="key">
          <Texte>
            {acces.nom} ({acces.identifiant}) se connecte avec ce mot de passe :
          </Texte>
          <Texte gras>{acces.motDePasse}</Texte>
          <Message
            type="info"
            texte="Il n’est affiché qu’une fois : transmettez-le par appel ou en message privé, jamais dans un groupe."
          />
          {acces.contact ? (
            <>
              <Bouton
                titre={`Envoyer par WhatsApp (${acces.contact})`}
                icone="logo-whatsapp"
                onPress={() => envoyerWhatsapp(acces)}
              />
              <Bouton
                titre={`Appeler ${acces.contact}`}
                icone="call"
                variante="secondaire"
                onPress={() => void Linking.openURL(`tel:${acces.contact}`)}
              />
            </>
          ) : null}
          <Bouton titre="C’est noté" variante="secondaire" onPress={() => setAcces(null)} />
        </Carte>
      ) : null}
      <Message texte={erreur} />

      <Section titre={`En attente (${enAttente.length})`} icone="notifications" />
      {demandes && !enAttente.length ? <Texte discret>Aucune demande en attente.</Texte> : null}
      {enAttente.map((d) => (
        <Carte key={d.id}>
          <FicheDemande d={d} />
          <Bouton
            titre="Donner un nouveau mot de passe"
            icone="key"
            chargement={enCours === d.id}
            onPress={() => void traiter(d, false)}
          />
          <Bouton titre="Ignorer" variante="secondaire" onPress={() => void traiter(d, true)} />
        </Carte>
      ))}

      <ReglageContact />

      {traitees.length ? <Section titre="Demandes traitées" icone="checkmark-done" /> : null}
      {traitees.map((d) => (
        <Carte key={d.id}>
          <FicheDemande d={d} />
          <Texte discret>
            {LIBELLES_STATUTS[d.statut]}
            {d.traiteLe ? ` le ${dateHeure(d.traiteLe)}` : ''}
            {d.traitePar ? ` par ${d.traitePar}` : ''}
          </Texte>
        </Carte>
      ))}
    </Ecran>
  );
}

function FicheDemande({ d }: { d: Demande }) {
  return (
    <>
      <Texte gras>
        {d.utilisateur
          ? `${d.utilisateur.nom} · ${LIBELLES_ROLES[d.utilisateur.role]}`
          : 'Compte supprimé'}
      </Texte>
      {d.utilisateur ? <Texte>Identifiant : {d.utilisateur.identifiant}</Texte> : null}
      <Texte>Commerce : {d.commerce?.nom ?? '?'}</Texte>
      {d.contact || d.utilisateur?.telephone ? (
        <Texte>Contact : {d.contact ?? d.utilisateur?.telephone}</Texte>
      ) : null}
      {d.message ? <Texte discret>« {d.message} »</Texte> : null}
      <Texte discret>Demandé le {dateHeure(d.creeLe)}</Texte>
    </>
  );
}

/** Contact montré aux commerçants sur l'écran « Mot de passe oublié ». */
function ReglageContact() {
  const { requete } = usePlateforme();
  const [contact, setContact] = useState<Contact | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    requete<Contact>('/contact').then(setContact, (e: unknown) =>
      setMessage({ texte: messageErreur(e), type: 'erreur' }),
    );
  }, [requete]);
  if (!contact) return null;
  const champ = (cle: keyof Contact) => ({
    value: contact[cle] ?? '',
    onChangeText: (v: string) => setContact({ ...contact, [cle]: v }),
  });

  const enregistrer = async () => {
    setMessage(null);
    setEnvoi(true);
    try {
      setContact(await requete<Contact>('/contact', { methode: 'PUT', corps: contact }));
      setMessage({ texte: 'Contact enregistré.', type: 'succes' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Carte titre="Contact affiché aux commerçants" icone="call">
      <Texte discret>
        Visible sur l’écran « Mot de passe oublié » pour vous appeler ou vous écrire directement.
      </Texte>
      <Champ libelle="Nom affiché" placeholder="Service client GestVente" {...champ('nom')} />
      <Champ
        libelle="Téléphone"
        keyboardType="phone-pad"
        placeholder="+224 620 00 00 00"
        {...champ('telephone')}
      />
      <Champ
        libelle="WhatsApp"
        keyboardType="phone-pad"
        placeholder="+224 620 00 00 00"
        {...champ('whatsapp')}
      />
      <Champ
        libelle="E-mail"
        keyboardType="email-address"
        autoCapitalize="none"
        {...champ('email')}
      />
      <Message texte={message?.texte ?? null} type={message?.type} />
      <Bouton
        titre="Enregistrer le contact"
        icone="save"
        chargement={envoi}
        onPress={() => void enregistrer()}
      />
    </Carte>
  );
}
