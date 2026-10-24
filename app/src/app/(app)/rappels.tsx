import {
  formaterMontant,
  INTERVALLE_RELANCE_JOURS,
  type ParametresRappels,
  TYPES_PENALITE,
  type TypePenalite,
} from '@gestvente/commun';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCouleurs } from '@/lib/theme';

interface Saisie {
  joursAvant: string;
  relancesMax: string;
  canal: 'SMS' | 'WHATSAPP';
  penaliteActive: boolean;
  penaliteType: TypePenalite;
  penaliteValeur: string;
  penaliteGrace: string;
}

const versSaisie = (p: ParametresRappels): Saisie => ({
  ...p,
  joursAvant: String(p.joursAvant),
  relancesMax: String(p.relancesMax),
  penaliteValeur: String(p.penaliteValeur),
  penaliteGrace: String(p.penaliteGrace),
});

const entier = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : Number.NaN);

/**
 * Rappels automatiques des tranches (chaque jour à 9 h) et pénalité de retard :
 * réglés par le propriétaire, consultés par les gérants. Réglages lus en ligne.
 */
export default function Rappels() {
  const c = useCouleurs();
  const { profil, api, rafraichirProfil } = useSession();
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const proprietaire = profil?.role === 'PROPRIETAIRE';

  useEffect(() => {
    api.requete<ParametresRappels>('/credits/parametres').then(
      (p) => setSaisie(versSaisie(p)),
      (e: unknown) => setMessage({ texte: messageErreur(e), type: 'erreur' }),
    );
  }, [api]);

  if (!profil)
    return (
      <Ecran titre="Rappels et pénalités" enHaut>
        {null}
      </Ecran>
    );
  const monnaie = profil.commerce.monnaie;
  const changer = (modif: Partial<Saisie>) => setSaisie((s) => (s ? { ...s, ...modif } : s));

  const enregistrer = async () => {
    if (!saisie) return;
    setMessage(null);
    const p: ParametresRappels = {
      ...saisie,
      joursAvant: entier(saisie.joursAvant),
      relancesMax: entier(saisie.relancesMax),
      penaliteValeur: entier(saisie.penaliteValeur || '0'),
      penaliteGrace: entier(saisie.penaliteGrace),
    };
    if ([p.joursAvant, p.relancesMax, p.penaliteValeur, p.penaliteGrace].some(Number.isNaN)) {
      return setMessage({ texte: 'Nombres entiers attendus.', type: 'erreur' });
    }
    setEnvoi(true);
    try {
      await api.requete('/credits/parametres', { methode: 'PUT', corps: p });
      await rafraichirProfil().catch(() => undefined);
      setMessage({ texte: 'Réglages enregistrés.', type: 'succes' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const saisieStyle = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];
  const champ = (cle: keyof Saisie, libelle: string, aide?: string) =>
    saisie ? (
      <>
        <Texte gras>{libelle}</Texte>
        <TextInput
          value={String(saisie[cle])}
          onChangeText={(t) => changer({ [cle]: t } as Partial<Saisie>)}
          keyboardType="number-pad"
          editable={proprietaire}
          accessibilityLabel={libelle}
          style={saisieStyle}
        />
        {aide ? <Texte discret>{aide}</Texte> : null}
      </>
    ) : null;

  return (
    <Ecran titre="Rappels et pénalités" sousTitre="Crédits par tranches" enHaut>
      {!proprietaire ? (
        <Message type="info" texte="Réglages fixés par le propriétaire (lecture seule)." />
      ) : null}
      <Message texte={message?.texte ?? null} type={message?.type} />
      {saisie ? (
        <>
          <Carte titre="Rappels automatiques" icone="notifications">
            <Texte discret>
              Chaque jour à 9 h : un rappel avant l’échéance, un le jour même, puis une relance tous
              les {INTERVALLE_RELANCE_JOURS} jours en cas de retard.
            </Texte>
            {champ('joursAvant', 'Rappel combien de jours avant ?', '0 : pas de rappel avant.')}
            {champ('relancesMax', 'Relances de retard au plus (par tranche)')}
            <Choix
              libelle="Envoyés par"
              options={[
                { id: 'SMS', nom: 'SMS' },
                { id: 'WHATSAPP', nom: 'WhatsApp (sinon SMS)' },
              ]}
              valeurs={[saisie.canal]}
              surChoix={([v]) => proprietaire && v && changer({ canal: v as Saisie['canal'] })}
            />
          </Carte>
          <Carte titre="Pénalité de retard" icone="alert-circle">
            <Choix
              libelle="Pénalité"
              options={[
                { id: 'non', nom: 'Désactivée' },
                { id: 'oui', nom: 'Activée' },
              ]}
              valeurs={[saisie.penaliteActive ? 'oui' : 'non']}
              surChoix={([v]) => proprietaire && v && changer({ penaliteActive: v === 'oui' })}
            />
            {saisie.penaliteActive ? (
              <>
                <Choix
                  libelle="Calcul"
                  options={TYPES_PENALITE.map((id) => ({
                    id,
                    nom: id === 'FIXE' ? `Montant fixe (${monnaie})` : '% de la tranche',
                  }))}
                  valeurs={[saisie.penaliteType]}
                  surChoix={([v]) =>
                    proprietaire && v && changer({ penaliteType: v as TypePenalite })
                  }
                />
                {champ(
                  'penaliteValeur',
                  saisie.penaliteType === 'FIXE' ? 'Montant' : 'Pourcentage',
                  saisie.penaliteType === 'FIXE' && entier(saisie.penaliteValeur) > 0
                    ? `${formaterMontant(entier(saisie.penaliteValeur), monnaie)} par tranche en retard.`
                    : 'Ajoutée une fois par tranche en retard, au reste dû.',
                )}
                {champ('penaliteGrace', 'Délai de grâce (jours de retard tolérés)')}
              </>
            ) : null}
          </Carte>
          {proprietaire ? (
            <Bouton
              titre="Enregistrer"
              icone="save"
              onPress={() => void enregistrer()}
              chargement={envoi}
            />
          ) : null}
        </>
      ) : !message ? (
        <Texte discret>Chargement…</Texte>
      ) : null}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
});
