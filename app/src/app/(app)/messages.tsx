import {
  type CanalMessage,
  erreurModele,
  EXEMPLE_VARIABLES,
  formaterMontant,
  LIBELLES_CANAUX,
  LIBELLES_STATUTS_MESSAGE,
  LIBELLES_TYPES_MESSAGE,
  LONGUEUR_SMS,
  remplir,
  type StatutMessage,
  type TypeMessage,
  VARIABLES_MESSAGE,
} from '@gestvente/commun';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { ErreurReseau, messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCouleurs } from '@/lib/theme';

interface Envoi {
  id: string;
  creeLe: string;
  envoyeLe: string | null;
  canal: CanalMessage;
  type: TypeMessage;
  statut: StatutMessage;
  destinataire: string;
  client: string | null;
  contenu: string;
  essais: number;
  cout: number | null;
  erreur: string | null;
}

interface Modele {
  type: TypeMessage;
  canal: CanalMessage;
  texte: string;
  parDefaut: string;
  personnalise: boolean;
  modifiable: boolean;
}

const ONGLETS = [
  { id: 'historique', nom: 'Envois' },
  { id: 'modeles', nom: 'Textes des messages' },
];
const STATUTS = [
  { id: 'tous', nom: 'Tous' },
  { id: 'ECHEC', nom: 'Échecs' },
  { id: 'EN_ATTENTE', nom: 'En attente' },
  { id: 'ENVOYE', nom: 'Envoyés' },
];

/** Messages aux clients : historique des envois (coût, échecs) et textes des SMS. */
export default function Messages() {
  const c = useCouleurs();
  const { profil, api } = useSession();
  const [onglet, setOnglet] = useState('historique');
  const [statut, setStatut] = useState('tous');
  const [envois, setEnvois] = useState<Envoi[]>([]);
  const [whatsapp, setWhatsapp] = useState(true);
  const [modeles, setModeles] = useState<Modele[]>([]);
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const proprietaire = profil?.role === 'PROPRIETAIRE';
  const monnaie = profil?.commerce.monnaie;

  // Rechargé après chaque action (relance, texte enregistré).
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let actif = true;
    const requete =
      onglet === 'historique'
        ? api
            .requete<{ messages: Envoi[]; whatsappDisponible: boolean }>(
              `/messages${statut === 'tous' ? '' : `?statut=${statut}`}`,
            )
            .then((r) => {
              if (!actif) return;
              setEnvois(r.messages);
              setWhatsapp(r.whatsappDisponible);
            })
        : api.requete<Modele[]>('/messages/modeles').then((m) => actif && setModeles(m));
    requete.catch((e: unknown) => {
      if (!actif) return;
      setMessage({
        texte:
          e instanceof ErreurReseau ? 'Les messages se consultent en ligne.' : messageErreur(e),
        type: 'erreur',
      });
    });
    return () => {
      actif = false;
    };
  }, [api, onglet, statut, version]);

  const relancer = async (id: string) => {
    setMessage(null);
    try {
      await api.requete(`/messages/${id}/relancer`, { methode: 'POST' });
      setMessage({ texte: 'Nouvel envoi programmé.', type: 'succes' });
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const enregistrerModele = async (m: Modele, texte: string | null) => {
    setMessage(null);
    try {
      if (texte === null) {
        await api.requete(`/messages/modeles/${m.type}/${m.canal}`, { methode: 'DELETE' });
      } else {
        await api.requete('/messages/modeles', {
          methode: 'PUT',
          corps: { type: m.type, canal: m.canal, texte },
        });
      }
      setSaisies((s) => {
        const { [`${m.type}-${m.canal}`]: _, ...reste } = s;
        return reste;
      });
      setMessage({ texte: 'Texte enregistré.', type: 'succes' });
      setVersion((v) => v + 1);
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const couleurStatut: Record<StatutMessage, string> = {
    EN_ATTENTE: c.alerte,
    ENVOYE: c.succes,
    DELIVRE: c.succes,
    ECHEC: c.danger,
  };

  return (
    <Ecran titre="Messages aux clients" sousTitre="SMS et WhatsApp" enHaut>
      <Choix
        libelle="Afficher"
        options={ONGLETS}
        valeurs={[onglet]}
        surChoix={([o]) => o && setOnglet(o)}
      />
      <Message texte={message?.texte ?? null} type={message?.type} />

      {onglet === 'historique' ? (
        <>
          {!whatsapp ? (
            <Message
              type="info"
              texte="WhatsApp Business n’est pas configuré sur le serveur : les envois partent en SMS."
            />
          ) : null}
          <Choix
            libelle="Statut"
            options={STATUTS}
            valeurs={[statut]}
            surChoix={([s]) => s && setStatut(s)}
          />
          {envois.length === 0 ? <Texte discret>Aucun message.</Texte> : null}
          {envois.map((e) => (
            <Carte key={e.id}>
              <Texte gras>
                {LIBELLES_TYPES_MESSAGE[e.type]} · {LIBELLES_CANAUX[e.canal]} ·{' '}
                <Texte gras>{LIBELLES_STATUTS_MESSAGE[e.statut]}</Texte>
              </Texte>
              <Texte discret>
                {new Date(e.creeLe).toLocaleString('fr-FR', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}{' '}
                · {e.client ?? 'client de passage'} · {e.destinataire}
              </Texte>
              <Texte>{e.contenu}</Texte>
              <Texte discret>
                {e.essais} essai(s){e.cout ? ` · coût ${formaterMontant(e.cout, monnaie)}` : ''}
              </Texte>
              {e.erreur ? <Message texte={e.erreur} /> : null}
              {e.statut === 'ECHEC' ? (
                <Bouton
                  titre="Relancer l’envoi"
                  icone="refresh"
                  variante="secondaire"
                  onPress={() => void relancer(e.id)}
                />
              ) : null}
              <View style={[styles.barre, { backgroundColor: couleurStatut[e.statut] }]} />
            </Carte>
          ))}
        </>
      ) : (
        <>
          <Texte discret>
            Variables : {VARIABLES_MESSAGE.map((v) => `{${v}}`).join(' ')}. Un SMS fait au plus{' '}
            {LONGUEUR_SMS} caractères. Les textes WhatsApp sont ceux des modèles approuvés par Meta.
          </Texte>
          {modeles.map((m) => {
            const cle = `${m.type}-${m.canal}`;
            const texte = saisies[cle] ?? m.texte;
            const apercu = remplir(texte, EXEMPLE_VARIABLES);
            const erreur = erreurModele(texte, m.canal);
            const modifie = saisies[cle] !== undefined && saisies[cle] !== m.texte;
            return (
              <Carte
                key={cle}
                titre={`${LIBELLES_TYPES_MESSAGE[m.type]} · ${LIBELLES_CANAUX[m.canal]}`}
                icone={m.canal === 'SMS' ? 'chatbox-ellipses' : 'logo-whatsapp'}
              >
                {m.modifiable && proprietaire ? (
                  <TextInput
                    value={texte}
                    onChangeText={(t) => setSaisies((s) => ({ ...s, [cle]: t }))}
                    multiline
                    accessibilityLabel={`Texte ${LIBELLES_TYPES_MESSAGE[m.type]} ${LIBELLES_CANAUX[m.canal]}`}
                    style={[
                      styles.saisie,
                      { color: c.texte, borderColor: c.bordure, backgroundColor: c.fond },
                    ]}
                  />
                ) : (
                  <Texte>{texte}</Texte>
                )}
                <Texte discret>Exemple : {apercu}</Texte>
                {m.canal === 'SMS' ? (
                  <Texte discret>
                    {apercu.length} / {LONGUEUR_SMS} caractères
                    {m.personnalise ? ' · texte personnalisé' : ' · texte par défaut'}
                  </Texte>
                ) : null}
                {m.modifiable && proprietaire && erreur ? <Message texte={erreur} /> : null}
                {m.modifiable && proprietaire && modifie ? (
                  <Bouton
                    titre="Enregistrer"
                    icone="checkmark"
                    desactive={!!erreur}
                    onPress={() => void enregistrerModele(m, texte)}
                  />
                ) : null}
                {m.modifiable && proprietaire && m.personnalise ? (
                  <Bouton
                    titre="Revenir au texte par défaut"
                    variante="secondaire"
                    onPress={() => void enregistrerModele(m, null)}
                  />
                ) : null}
              </Carte>
            );
          })}
        </>
      )}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  saisie: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  barre: { height: 4, borderRadius: 2, marginTop: 4 },
});
