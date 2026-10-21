import {
  contratCreditHtml,
  formaterDate,
  formaterMontant,
  jourFr,
  jourLocal,
  LIBELLES_FREQUENCES,
  LIBELLES_MOYENS,
  LIBELLES_STATUTS_CREDIT,
  lignesRecuEncaissement,
  MOYENS_REMBOURSEMENT,
  type MoyenRemboursement,
  moyenAvecReference,
  type RecuEncaissement,
  recuEncaissementHtml,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Choix } from '@/components/choix';
import { ImpressionDocument } from '@/components/impression-document';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { caisseOuverte } from '@/lib/caisse-session';
import { detailCredit, documentContrat, recuEncaissement } from '@/lib/credits';
import { FUSEAU_PAR_DEFAUT, lireReglagesImpression } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

const entier = (texte: string) => {
  const propre = texte.replace(/[\s  ]/g, '');
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/**
 * Fiche d'un crédit : échéancier, encaissement d'une tranche (totale ou partielle,
 * hors ligne, dans la caisse ouverte), reçu avec le solde, contrat imprimable.
 */
export default function FicheCredit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const { base, enregistrer } = useSync();
  const [montant, setMontant] = useState('');
  const [moyen, setMoyen] = useState<MoyenRemboursement>('ESPECES');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [recuId, setRecuId] = useState<string | null>(null);
  const fuseau = profil?.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const aujourdhui = jourLocal(new Date(), fuseau);
  const boutiqueId = boutique?.id ?? '';

  const detail = useLecture((b) => detailCredit(b, id, aujourdhui), [id, aujourdhui]);
  const reglages = useLecture((b) => lireReglagesImpression(b), []);
  const caisse = useLecture(
    (b) => (profil ? caisseOuverte(b, boutiqueId, profil.id) : Promise.resolve(null)),
    [boutiqueId, profil?.id],
  );
  const contrat = useLecture(
    async (b) =>
      detail && profil && boutique
        ? documentContrat(
            b,
            detail,
            {
              commerce: profil.commerce.nom,
              boutique,
              monnaie: profil.commerce.monnaie,
              fuseau,
            },
            profil.nom,
          )
        : null,
    [detail, boutique?.id],
  );

  if (!profil || !boutique || !base || !detail) {
    return (
      <Ecran titre="Crédit" enHaut>
        {detail === null ? <Message texte="Crédit introuvable sur cet appareil." /> : null}
      </Ecran>
    );
  }
  const monnaie = profil.commerce.monnaie;
  const { credit, situation } = detail;
  const entete = { commerce: profil.commerce.nom, boutique, monnaie, fuseau };
  const recu: RecuEncaissement | null = recuId
    ? recuEncaissement(detail, recuId, entete, profil.nom)
    : null;
  const suggestion = situation.montantEchu || situation.prochaine?.reste || 0;

  const encaisser = async () => {
    setMessage(null);
    const valeur = entier(montant || String(suggestion));
    if (Number.isNaN(valeur) || valeur <= 0) {
      return setMessage({ texte: 'Montant : nombre entier attendu.', type: 'erreur' });
    }
    if (!caisse) {
      return setMessage({ texte: 'Ouvrez votre caisse avant d’encaisser.', type: 'erreur' });
    }
    setEnvoi(true);
    try {
      const encaissementId = Crypto.randomUUID();
      await enregistrer({
        type: 'CREDIT_ENCAISSER',
        boutiqueId,
        contenu: {
          id: encaissementId,
          creditId: credit.id,
          dateEncaissement: new Date().toISOString(),
          moyen,
          montant: valeur,
          reference: moyenAvecReference(moyen) ? reference.trim() || null : null,
          caisseId: caisse.id,
        },
      });
      setRecuId(encaissementId);
      setMontant('');
      setReference('');
      setMessage({
        texte: `${formaterMontant(valeur, monnaie)} encaissés. Reste dû : ${formaterMontant(
          situation.restant - valeur,
          monnaie,
        )}.`,
        type: 'succes',
      });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Ecran titre={detail.client.nom} sousTitre={`Crédit · facture ${credit.numeroVente}`} enHaut>
      <Carte titre={LIBELLES_STATUTS_CREDIT[situation.statut]} icone="wallet">
        <Texte gras>Reste dû : {formaterMontant(situation.restant, monnaie)}</Texte>
        <Texte discret>
          Prix {formaterMontant(credit.montantTotal, monnaie)} · apport{' '}
          {formaterMontant(credit.apport, monnaie)} · financé{' '}
          {formaterMontant(credit.montantFinance, monnaie)}
        </Texte>
        <Texte discret>
          {credit.nombreTranches} tranche(s), {LIBELLES_FREQUENCES[credit.frequence].toLowerCase()}
          {detail.garant ? ` · garant : ${detail.garant.nom}` : ''}
        </Texte>
        {situation.joursRetard ? (
          <Message
            texte={`${situation.tranchesEnRetard} tranche(s) en retard (${situation.joursRetard} jours) : ${formaterMontant(situation.montantEchu, monnaie)} échus.`}
          />
        ) : null}
        <Bouton
          titre="Fiche du client"
          variante="secondaire"
          icone="person-outline"
          onPress={() =>
            router.push({ pathname: '/client/[id]', params: { id: detail.client.id } })
          }
        />
      </Carte>

      <Message texte={message?.texte ?? null} type={message?.type} />
      {recu && reglages ? (
        <Carte titre="Reçu de la tranche" icone="receipt">
          <Texte>
            {formaterMontant(recu.montant, monnaie)} · reste dû{' '}
            {formaterMontant(recu.restant, monnaie)}
          </Texte>
          <ImpressionDocument
            titre="Reçu de tranche"
            reglages={reglages}
            ticket={{
              lignes: (largeur) => lignesRecuEncaissement(recu, largeur),
              html: (largeur) => recuEncaissementHtml(recu, largeur),
            }}
          />
        </Carte>
      ) : null}

      {credit.statut === 'EN_COURS' ? (
        <Carte titre="Encaisser une tranche" icone="cash">
          {caisse === null ? (
            <Message texte="Caisse fermée : ouvrez votre caisse pour encaisser." />
          ) : null}
          <TextInput
            value={montant}
            onChangeText={setMontant}
            placeholder={suggestion ? String(suggestion) : 'Montant versé'}
            placeholderTextColor={c.texteDiscret}
            keyboardType="number-pad"
            accessibilityLabel="Montant versé"
            style={saisie}
          />
          {suggestion ? (
            <Texte discret>
              Vide : {formaterMontant(suggestion, monnaie)}
              {situation.montantEchu ? ' (montant échu)' : ' (prochaine tranche)'}. Un versement
              partiel est accepté.
            </Texte>
          ) : null}
          <Choix
            libelle="Moyen"
            options={MOYENS_REMBOURSEMENT.map((m) => ({ id: m, nom: LIBELLES_MOYENS[m] }))}
            valeurs={[moyen]}
            surChoix={([v]) => v && setMoyen(v as MoyenRemboursement)}
          />
          {moyenAvecReference(moyen) ? (
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="Référence de la transaction"
              placeholderTextColor={c.texteDiscret}
              accessibilityLabel="Référence de la transaction"
              style={saisie}
            />
          ) : null}
          <Bouton
            titre="Encaisser"
            icone="checkmark-circle"
            onPress={() => void encaisser()}
            chargement={envoi}
          />
        </Carte>
      ) : null}

      <Carte titre="Échéancier" icone="calendar">
        {detail.echeances.map((e) => {
          const reste = e.montant + e.penalite - e.montantPaye;
          const enRetard = reste > 0 && e.dateEcheance < aujourdhui;
          return (
            <View key={e.id} style={styles.tranche}>
              <View style={{ flex: 1 }}>
                <Texte gras={enRetard}>
                  {e.numero}. {jourFr(e.dateEcheance)}
                  {enRetard ? ' · en retard' : ''}
                </Texte>
                <Texte discret>
                  {reste <= 0
                    ? `Payée${e.soldeeLe ? ` le ${formaterDate(e.soldeeLe, fuseau)}` : ''}`
                    : e.montantPaye > 0
                      ? `Payé ${formaterMontant(e.montantPaye, monnaie)}, reste ${formaterMontant(reste, monnaie)}`
                      : 'À payer'}
                </Texte>
              </View>
              <Texte gras>{formaterMontant(e.montant + e.penalite, monnaie)}</Texte>
            </View>
          );
        })}
      </Carte>

      <Carte titre="Versements" icone="time">
        {detail.encaissements.length === 0 ? (
          <Texte discret>
            Apport de {formaterMontant(credit.apport, monnaie)} payé à la vente ; aucune tranche
            encaissée.
          </Texte>
        ) : null}
        {detail.encaissements.map((e) => (
          <View key={e.id} style={styles.tranche}>
            <View style={{ flex: 1 }}>
              <Texte>
                {formaterDate(e.creeLe, fuseau, true)} · {LIBELLES_MOYENS[e.moyen]}
                {e.reference ? ` (${e.reference})` : ''}
              </Texte>
            </View>
            <Texte gras>{formaterMontant(e.montant, monnaie)}</Texte>
            <Bouton titre="Reçu" variante="secondaire" onPress={() => setRecuId(e.id)} />
          </View>
        ))}
      </Carte>

      {contrat && reglages ? (
        <Carte titre="Contrat de crédit" icone="document-text">
          <Texte discret>À imprimer en deux exemplaires, signés par le client et le garant.</Texte>
          <ImpressionDocument
            titre="Contrat de crédit"
            reglages={reglages}
            a4={() => contratCreditHtml(contrat)}
          />
        </Carte>
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
  tranche: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
