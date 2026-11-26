import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bouton, Carte, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { empreinteAppareil } from '@/lib/cle-appareil';
import { confirmer } from '@/lib/confirmer';
import { useCouleurs } from '@/lib/theme';

/** Données renvoyées par l'API (commerçant ou concepteur). */
export interface ListeAppareils {
  utilisateurs: { id: string; nom: string; identifiant: string; role: string; actif: boolean }[];
  appareils: {
    id: string;
    titulaireId: string;
    nom: string;
    plateforme: string;
    origine: string;
    empreinte: string;
    creeLe: string;
    dernierUsage: string | null;
    revoqueLe: string | null;
    revoquePar: string | null;
  }[];
  codes: { titulaireId: string; expireLe: string; creePar: string; remplacer: boolean }[];
}

export interface CodeCree {
  code: string;
  expireLe: string;
  remplacer: boolean;
}

const LIBELLES_ROLES: Record<string, string> = {
  PROPRIETAIRE: 'Propriétaire',
  GERANT: 'Gérant',
  VENDEUR: 'Vendeur',
  CONCEPTEUR: 'Concepteur',
};

const LIBELLES_ORIGINES: Record<string, string> = {
  PREMIER_APPAREIL: 'premier appareil du compte',
  SESSION_EXISTANTE: 'déjà connecté avant la certification',
  CODE: 'autorisé par code',
};

type Icone = ComponentProps<typeof Ionicons>['name'];
const ICONES: Record<string, Icone> = {
  android: 'logo-android',
  ios: 'logo-apple',
  macos: 'laptop',
  windows: 'desktop',
  web: 'globe',
};

const dateHeure = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Appareils autorisés de chaque compte : nouvel appareil (code d'autorisation à usage
 * unique, valable 24 heures, qui remplace l'ancien ou s'ajoute), révocation d'un appareil.
 */
export function AppareilsAutorises({
  donnees,
  creerCode,
  revoquer,
  apresChangement,
  idCourant,
}: {
  donnees: ListeAppareils;
  creerCode: (titulaireId: string, remplacer: boolean) => Promise<CodeCree>;
  revoquer: (appareilId: string) => Promise<void>;
  apresChangement: () => void;
  /** Compte connecté sur cet écran (révoquer son propre appareil le déconnecte). */
  idCourant?: string;
}) {
  const c = useCouleurs();
  const [empreinte, setEmpreinte] = useState<string | null>(null);
  const [code, setCode] = useState<(CodeCree & { nom: string }) | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [anciensVisibles, setAnciensVisibles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    empreinteAppareil().then(setEmpreinte, () => setEmpreinte(null));
  }, []);

  const nouveauCode = async (u: ListeAppareils['utilisateurs'][number], remplacer: boolean) => {
    const message = remplacer
      ? `Créer un code pour le nouvel appareil de ${u.nom} ? Dès qu’il sera utilisé, les anciens appareils de ${u.nom} seront retirés.`
      : `Créer un code pour un appareil supplémentaire de ${u.nom} ? Ses appareils actuels restent autorisés.`;
    if (!(await confirmer(message, 'Créer le code'))) return;
    setErreur(null);
    setEnCours(`code-${u.id}`);
    try {
      setCode({ ...(await creerCode(u.id, remplacer)), nom: u.nom });
      apresChangement();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  const retirer = async (a: ListeAppareils['appareils'][number], nom: string) => {
    const lui = a.empreinte === empreinte && a.titulaireId === idCourant;
    const message = lui
      ? `Retirer cet appareil (celui que vous utilisez) ? Vous serez déconnecté et il faudra un code pour revenir.`
      : `Retirer l’appareil « ${a.nom} » de ${nom} ? Sa session se ferme aussitôt et il ne pourra plus se connecter sans nouveau code.`;
    if (!(await confirmer(message, 'Retirer l’appareil'))) return;
    setErreur(null);
    setEnCours(a.id);
    try {
      await revoquer(a.id);
      apresChangement();
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <>
      {code ? (
        <Carte titre={`Code d’autorisation pour ${code.nom}`} icone="key">
          <Text selectable style={[styles.code, { color: c.texte, borderColor: c.accent }]}>
            {code.code}
          </Text>
          <Texte>
            À saisir sur le nouvel appareil, à la connexion, avec l’identifiant et le mot de passe.
            Valable jusqu’au {dateHeure(code.expireLe)}, une seule fois.
          </Texte>
          <Texte discret>
            {code.remplacer
              ? 'Les anciens appareils seront retirés dès que le nouveau sera enregistré.'
              : 'Appareil supplémentaire : les autres restent autorisés.'}
          </Texte>
          <Message
            type="info"
            texte="Affiché une seule fois : donnez-le par appel ou en main propre, jamais dans un groupe."
          />
          <Bouton titre="C’est noté" variante="secondaire" onPress={() => setCode(null)} />
        </Carte>
      ) : null}
      <Message texte={erreur} />

      {donnees.utilisateurs.map((u) => {
        const actifs = donnees.appareils.filter((a) => a.titulaireId === u.id && !a.revoqueLe);
        const retires = donnees.appareils.filter((a) => a.titulaireId === u.id && a.revoqueLe);
        const enAttente = donnees.codes.find((x) => x.titulaireId === u.id);
        return (
          <Carte key={u.id}>
            <View style={styles.entete}>
              <Ionicons name="person-circle" size={26} color={c.primaire} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.nom, { color: c.texte }]}>{u.nom}</Text>
                <Text style={{ color: c.texteDiscret }}>
                  {LIBELLES_ROLES[u.role] ?? u.role} · {u.identifiant}
                  {u.actif ? '' : ' · compte désactivé'}
                </Text>
              </View>
            </View>

            {actifs.length ? null : (
              <Texte discret>
                Aucun appareil autorisé : le prochain appareil qui se connecte devra avoir un code
                {donnees.appareils.some((a) => a.titulaireId === u.id)
                  ? '.'
                  : ' (sauf le tout premier, autorisé d’office).'}
              </Texte>
            )}
            {actifs.map((a) => {
              const cetAppareil = a.empreinte === empreinte;
              return (
                <View key={a.id} style={[styles.appareil, { borderColor: c.bordure }]}>
                  <Ionicons
                    name={ICONES[a.plateforme] ?? 'phone-portrait'}
                    size={22}
                    color={c.texte}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: c.texte, fontWeight: '700' }}>
                      {a.nom}
                      {cetAppareil ? ' (cet appareil)' : ''}
                    </Text>
                    <Text style={{ color: c.texteDiscret }}>
                      Empreinte {a.empreinte} · {LIBELLES_ORIGINES[a.origine] ?? a.origine}
                    </Text>
                    <Text style={{ color: c.texteDiscret }}>
                      Autorisé le {dateHeure(a.creeLe)}
                      {a.dernierUsage ? ` · dernière connexion ${dateHeure(a.dernierUsage)}` : ''}
                    </Text>
                  </View>
                  <Bouton
                    titre="Retirer"
                    icone="close-circle"
                    variante="danger"
                    chargement={enCours === a.id}
                    onPress={() => void retirer(a, u.nom)}
                  />
                </View>
              );
            })}

            {enAttente ? (
              <Texte discret>
                Code en attente (créé par {enAttente.creePar}), valable jusqu’au{' '}
                {dateHeure(enAttente.expireLe)}. Un nouveau code annule celui-ci.
              </Texte>
            ) : null}

            <Bouton
              titre="Nouvel appareil (remplace l’ancien)"
              icone="swap-horizontal"
              chargement={enCours === `code-${u.id}`}
              onPress={() => void nouveauCode(u, true)}
            />
            <Bouton
              titre="Ajouter un appareil en plus"
              icone="add-circle"
              variante="secondaire"
              onPress={() => void nouveauCode(u, false)}
            />

            {retires.length ? (
              <Bouton
                titre={
                  anciensVisibles[u.id]
                    ? 'Masquer les appareils retirés'
                    : `Appareils retirés (${retires.length})`
                }
                variante="secondaire"
                onPress={() => setAnciensVisibles((v) => ({ ...v, [u.id]: !v[u.id] }))}
              />
            ) : null}
            {anciensVisibles[u.id]
              ? retires.map((a) => (
                  <Texte key={a.id} discret>
                    {a.nom} · retiré le {dateHeure(a.revoqueLe!)}
                    {a.revoquePar ? ` par ${a.revoquePar}` : ''}
                  </Texte>
                ))
              : null}
          </Carte>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  entete: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nom: { fontSize: 17, fontWeight: '700' },
  appareil: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  code: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 10,
  },
});
