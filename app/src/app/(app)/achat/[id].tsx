import {
  type AchatSync,
  formaterMontant,
  LIBELLES_MOYENS,
  MOYENS_REMBOURSEMENT,
  type MoyenRemboursement,
  type ReceptionSaisie,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SaisieImei } from '@/components/saisie-imei';
import {
  Bouton,
  Carte,
  Champ,
  Ecran,
  ListeDeroulante,
  Message,
  styleSaisie,
  Texte,
} from '@/components/ui';
import { LIBELLES_STATUTS_ACHAT, lignesAchat } from '@/lib/achats';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

type EtatMessage = { texte: string; type: 'erreur' | 'succes' } | null;

const OPTIONS_MOYENS = MOYENS_REMBOURSEMENT.map((m) => ({
  valeur: m,
  libelle: LIBELLES_MOYENS[m],
}));
const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};

/**
 * Bon d'achat : réception en quantité (IMEI des téléphones facultatifs) et paiement au
 * fournisseur dans le même geste (montant, mode, référence) ; paiements suivants,
 * correction du bon, annulation.
 */
export default function FicheAchat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [imeis, setImeis] = useState<Record<string, string[]>>({});
  const [imeisOuverts, setImeisOuverts] = useState<Record<string, boolean>>({});
  const [montant, setMontant] = useState('');
  const [moyen, setMoyen] = useState<MoyenRemboursement>('ESPECES');
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState<EtatMessage>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (b) => ({
      achat: await b.premier<
        Omit<AchatSync, 'paiements'> & { fournisseur: string | null; paiements: string | null }
      >(
        'SELECT a.*, f.nom AS fournisseur FROM achat a LEFT JOIN fournisseur f ON f.id = a.fournisseurId WHERE a.id = ?',
        [id],
      ),
      lignes: await lignesAchat(b, id),
      imeisConnus: new Set(
        (await b.tous<{ imei: string }>('SELECT imei FROM article')).map((a) => a.imei),
      ),
    }),
    [id],
  );

  if (!donnees)
    return (
      <Ecran titre="Bon d’achat" enHaut>
        {null}
      </Ecran>
    );
  const { achat, lignes, imeisConnus } = donnees;
  if (!achat || !boutique) {
    return (
      <Ecran titre="Bon d’achat" enHaut>
        <Message texte="Bon d’achat introuvable." />
      </Ecran>
    );
  }
  const actif = achat.statut === 'BROUILLON' || achat.statut === 'PARTIEL';
  const reste = achat.montantTotal - achat.montantPaye;
  const rienRecu = lignes.every((l) => l.quantiteRecue === 0);
  const paiements = (achat.paiements ? JSON.parse(achat.paiements) : []) as AchatSync['paiements'];
  // Quantité saisie, ou par défaut tout ce qui reste à recevoir.
  const quantiteDe = (ligneId: string, attendu: number) =>
    quantites[ligneId] === undefined ? attendu : entier(quantites[ligneId]);

  const executer = async (action: () => Promise<void>, succes: string) => {
    setMessage(null);
    setEnvoi(true);
    try {
      await action();
      setMessage({ texte: succes, type: 'succes' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  /** Paiement (facultatif) : montant, mode, référence. */
  const paiementSaisi = () => {
    if (!montant.trim()) return null;
    const valeur = entier(montant);
    if (!Number.isInteger(valeur) || valeur <= 0)
      throw new Error('Montant payé : nombre entier positif attendu.');
    return {
      achatId: achat.id,
      montant: valeur,
      moyen,
      reference: moyen === 'ESPECES' ? null : reference.trim() || null,
    };
  };

  const recevoir = () =>
    executer(async () => {
      const receptions: ReceptionSaisie['lignes'] = [];
      for (const l of lignes) {
        const attendu = l.quantite - l.quantiteRecue;
        if (attendu <= 0) continue;
        const q = quantiteDe(l.id, attendu);
        if (!Number.isInteger(q) || q < 0)
          throw new Error(`« ${l.nom} » : quantité reçue en nombre entier.`);
        if (q === 0) continue;
        const liste = l.type === 'TELEPHONE' ? (imeis[l.id] ?? []) : [];
        receptions.push({
          ligneId: l.id,
          quantite: q,
          ...(liste.length
            ? { articles: liste.map((imei) => ({ id: Crypto.randomUUID(), imei })) }
            : {}),
        });
      }
      if (!receptions.length) throw new Error('Indiquez au moins une quantité reçue.');
      const paiement = paiementSaisi();
      await enregistrer({
        type: 'ACHAT_RECEVOIR',
        boutiqueId: boutique.id,
        contenu: { achatId: achat.id, lignes: receptions },
      });
      if (paiement) {
        await enregistrer({ type: 'ACHAT_PAYER', boutiqueId: boutique.id, contenu: paiement });
      }
      setQuantites({});
      setImeis({});
      setMontant('');
      setReference('');
    }, 'Réception enregistrée : le stock est à jour.');

  const payer = () =>
    executer(async () => {
      const paiement = paiementSaisi();
      if (!paiement) throw new Error('Indiquez le montant payé.');
      await enregistrer({ type: 'ACHAT_PAYER', boutiqueId: boutique.id, contenu: paiement });
      setMontant('');
      setReference('');
    }, 'Paiement enregistré.');

  const annuler = async () => {
    if (!(await confirmer(`Annuler le bon ${achat.numero} ?`, 'Annuler le bon'))) return;
    await executer(
      () =>
        enregistrer({
          type: 'ACHAT_ANNULER',
          boutiqueId: boutique.id,
          contenu: { achatId: achat.id },
        }),
      'Bon annulé.',
    );
  };

  const blocPaiement = (
    <>
      <Champ
        libelle={`Montant payé maintenant (reste dû : ${formaterMontant(reste, monnaie)})`}
        value={montant}
        onChangeText={setMontant}
        keyboardType="number-pad"
        placeholder="Laisser vide si rien n’est payé"
      />
      <ListeDeroulante
        libelle="Mode de paiement"
        options={OPTIONS_MOYENS}
        valeur={moyen}
        surChoix={(v) => setMoyen(v as MoyenRemboursement)}
      />
      {moyen !== 'ESPECES' ? (
        <Champ
          libelle="Référence (facultatif)"
          value={reference}
          onChangeText={setReference}
          placeholder="N° de transaction, de virement…"
        />
      ) : null}
    </>
  );

  return (
    <Ecran titre={`Bon ${achat.numero}`} sousTitre={achat.fournisseur ?? undefined} enHaut>
      <Carte>
        <Texte gras>{LIBELLES_STATUTS_ACHAT[achat.statut]}</Texte>
        <Texte discret>
          Date : {new Date(`${achat.dateAchat}T12:00:00`).toLocaleDateString('fr-FR')}
        </Texte>
        <Texte>Total : {formaterMontant(achat.montantTotal, monnaie)}</Texte>
        <Texte>
          Payé : {formaterMontant(achat.montantPaye, monnaie)}
          {achat.statut !== 'ANNULE' && reste > 0
            ? ` · reste dû ${formaterMontant(reste, monnaie)}`
            : ''}
        </Texte>
        {achat.note ? <Texte discret>{achat.note}</Texte> : null}
        {achat.statut !== 'ANNULE' ? (
          <Bouton
            titre="Modifier le bon"
            icone="create"
            variante="secondaire"
            onPress={() => router.push({ pathname: '/achat/edition', params: { id: achat.id } })}
          />
        ) : null}
      </Carte>
      <Message texte={message?.texte ?? null} type={message?.type} />

      {actif ? (
        <Carte titre="Réception de la marchandise" icone="cube">
          <Texte discret>
            Indiquez la quantité reçue (déjà remplie avec ce qui reste à recevoir). Les IMEI des
            téléphones sont facultatifs.
          </Texte>
          {lignes.map((l) => {
            const attendu = l.quantite - l.quantiteRecue;
            if (attendu <= 0) return null;
            const q = quantiteDe(l.id, attendu);
            return (
              <View key={l.id} style={[styles.ligne, { borderBottomColor: c.bordure }]}>
                <View style={styles.rangee}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.texte, fontWeight: '700' }}>{l.nom}</Text>
                    <Text style={{ color: c.texteDiscret, fontSize: 13 }}>
                      Reçu {l.quantiteRecue} / {l.quantite} ·{' '}
                      {formaterMontant(l.prixAchat, monnaie)} l’unité
                    </Text>
                  </View>
                  <TextInput
                    value={quantites[l.id] ?? String(attendu)}
                    onChangeText={(t) => setQuantites((x) => ({ ...x, [l.id]: t }))}
                    keyboardType="number-pad"
                    accessibilityLabel={`Quantité reçue de ${l.nom}`}
                    style={[
                      styleSaisie(c) as object,
                      { width: 80, minHeight: 42, paddingVertical: 6, textAlign: 'center' },
                    ]}
                  />
                </View>
                {l.type === 'TELEPHONE' && Number.isInteger(q) && q > 0 ? (
                  imeisOuverts[l.id] ? (
                    <SaisieImei
                      libelle="IMEI reçus (facultatif)"
                      imeis={imeis[l.id] ?? []}
                      surChangement={(liste) => setImeis((i) => ({ ...i, [l.id]: liste }))}
                      dejaConnu={(imei) => imeisConnus.has(imei)}
                      maximum={q}
                    />
                  ) : (
                    <Bouton
                      titre="Ajouter les IMEI (facultatif)"
                      icone="barcode"
                      variante="secondaire"
                      onPress={() => setImeisOuverts((o) => ({ ...o, [l.id]: true }))}
                    />
                  )
                ) : null}
              </View>
            );
          })}
          {reste > 0 ? blocPaiement : null}
          <Bouton
            titre="Valider la réception"
            icone="checkmark-circle"
            onPress={() => void recevoir()}
            chargement={envoi}
          />
        </Carte>
      ) : null}

      {!actif && achat.statut !== 'ANNULE' && reste > 0 ? (
        <Carte titre="Paiement au fournisseur" icone="cash">
          {blocPaiement}
          <Bouton
            titre="Enregistrer le paiement"
            icone="cash"
            onPress={() => void payer()}
            chargement={envoi}
          />
        </Carte>
      ) : null}

      {paiements.length ? (
        <Carte titre="Paiements effectués" icone="receipt">
          {paiements.map((p, i) => (
            <Texte key={i}>
              {new Date(p.date).toLocaleDateString('fr-FR')} · {formaterMontant(p.montant, monnaie)}{' '}
              · {LIBELLES_MOYENS[p.moyen as MoyenRemboursement] ?? p.moyen}
              {p.reference ? ` · réf. ${p.reference}` : ''}
            </Texte>
          ))}
        </Carte>
      ) : null}

      {actif && rienRecu ? (
        <Bouton titre="Annuler le bon" variante="danger" onPress={() => void annuler()} />
      ) : null}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: { gap: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rangee: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
