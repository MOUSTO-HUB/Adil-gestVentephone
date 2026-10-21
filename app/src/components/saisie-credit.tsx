import {
  type ClientSync,
  erreurFicheCredit,
  formaterMontant,
  FREQUENCES_CREDIT,
  jourFr,
  LIBELLES_FREQUENCES,
  premiereEcheanceParDefaut,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Message, Texte } from '@/components/ui';
import { creditDepuisFormulaire, type FormulaireCredit } from '@/lib/credit-saisie';
import { encoursClient, ficheCredit } from '@/lib/sync/operations-credits';
import { useLecture } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

const versFr = (jour: string) => jour.split('-').reverse().join('/');

/**
 * Vente à crédit : fiche client complète, plafond (encours + ce crédit), apport,
 * tranches, fréquence, première échéance, garant ; échéancier affiché avant l'encaissement.
 */
export function SaisieCredit({
  formulaire: f,
  surChange,
  client,
  total,
  aujourdhui,
  monnaie,
}: {
  formulaire: FormulaireCredit;
  surChange: (f: FormulaireCredit) => void;
  client: ClientSync | null;
  /** Total de la vente après remise et reprise. */
  total: number;
  aujourdhui: string;
  monnaie: string | undefined;
}) {
  const c = useCouleurs();
  const changer = (modif: Partial<FormulaireCredit>) => surChange({ ...f, ...modif });
  const infos = useLecture(
    async (b) =>
      client
        ? {
            fiche: await ficheCredit(b, client.id),
            encours: await encoursClient(b, client.id),
            garant: await b.premier<{ id: string; nom: string }>(
              'SELECT id, nom FROM garant WHERE clientId = ?',
              [client.id],
            ),
          }
        : null,
    [client?.id, client],
  );
  const erreurFiche = client ? erreurFicheCredit(infos?.fiche ?? null) : null;
  const apercu = creditDepuisFormulaire(f, total, aujourdhui, infos?.garant?.id ?? null, () => '');
  const finance = 'credit' in apercu ? total - apercu.credit.apport : null;
  const plafond = infos?.fiche?.plafondCredit ?? null;
  const disponible = plafond === null ? null : plafond - (infos?.encours ?? 0);

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Carte titre="Vente à crédit" icone="calendar">
      {!client ? (
        <Message
          type="info"
          texte="Choisissez le client : sa fiche complète (pièce d’identité, adresse) est obligatoire."
        />
      ) : erreurFiche ? (
        <>
          <Message texte={erreurFiche} />
          <Bouton
            titre="Compléter la fiche client"
            variante="secondaire"
            icone="id-card-outline"
            onPress={() => router.push({ pathname: '/client/[id]', params: { id: client.id } })}
          />
        </>
      ) : plafond === null ? (
        <Message texte="Ce client n’a pas de plafond de crédit : le propriétaire le fixe sur sa fiche." />
      ) : (
        <Texte discret>
          Plafond {formaterMontant(plafond, monnaie)} · encours{' '}
          {formaterMontant(infos?.encours ?? 0, monnaie)} · disponible{' '}
          {formaterMontant(Math.max(0, disponible ?? 0), monnaie)}
        </Texte>
      )}

      <Texte gras>Apport payé aujourd’hui</Texte>
      <TextInput
        value={f.apport}
        onChangeText={(apport) => changer({ apport })}
        placeholder="0"
        placeholderTextColor={c.texteDiscret}
        keyboardType="number-pad"
        accessibilityLabel="Apport initial"
        style={saisie}
      />
      <Choix
        libelle="Fréquence des tranches"
        options={FREQUENCES_CREDIT.map((id) => ({ id, nom: LIBELLES_FREQUENCES[id] }))}
        valeurs={[f.frequence]}
        surChoix={([v]) => {
          if (!v) return;
          const frequence = v as FormulaireCredit['frequence'];
          changer({
            frequence,
            premiere: versFr(premiereEcheanceParDefaut(aujourdhui, frequence)),
          });
        }}
      />
      <View style={styles.ligne}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <Texte gras>Nombre de tranches</Texte>
          <TextInput
            value={f.tranches}
            onChangeText={(tranches) => changer({ tranches })}
            keyboardType="number-pad"
            accessibilityLabel="Nombre de tranches"
            style={saisie}
          />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Texte gras>Première échéance</Texte>
          <TextInput
            value={f.premiere}
            onChangeText={(premiere) => changer({ premiere })}
            placeholder="JJ/MM/AAAA"
            placeholderTextColor={c.texteDiscret}
            accessibilityLabel="Date de la première échéance"
            style={saisie}
          />
        </View>
      </View>
      {infos?.garant ? (
        <Choix
          libelle="Garant"
          options={[
            { id: 'oui', nom: infos.garant.nom },
            { id: 'non', nom: 'Sans garant' },
          ]}
          valeurs={[f.avecGarant ? 'oui' : 'non']}
          surChoix={([v]) => v && changer({ avecGarant: v === 'oui' })}
        />
      ) : client ? (
        <Texte discret>Pas de garant sur la fiche (facultatif).</Texte>
      ) : null}

      {'erreur' in apercu ? (
        total > 0 ? (
          <Texte discret>{apercu.erreur}</Texte>
        ) : null
      ) : (
        <>
          <Texte gras>
            Reste à financer : {formaterMontant(finance ?? 0, monnaie)} en {apercu.tranches.length}{' '}
            tranche(s)
          </Texte>
          {disponible !== null && finance !== null && finance > disponible ? (
            <Message texte="Ce crédit dépasse le plafond disponible du client." />
          ) : null}
          {apercu.tranches.map((t) => (
            <View key={t.numero} style={styles.tranche}>
              <Texte>
                {t.numero}. {jourFr(t.date)}
              </Texte>
              <Texte gras>{formaterMontant(t.montant, monnaie)}</Texte>
            </View>
          ))}
        </>
      )}
    </Carte>
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
  ligne: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  tranche: { flexDirection: 'row', justifyContent: 'space-between' },
});
