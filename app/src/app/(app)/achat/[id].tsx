import { type AchatSync, formaterMontant, type ReceptionSaisie } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams, useTheme } from 'expo-router';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { SaisieImei } from '@/components/saisie-imei';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { LIBELLES_STATUTS_ACHAT, lignesAchat } from '@/lib/achats';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

type EtatMessage = { texte: string; type: 'erreur' | 'info' } | null;

/** Bon d'achat : lignes, réception (IMEI ou quantités), paiements, annulation. */
export default function FicheAchat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const [imeis, setImeis] = useState<Record<string, string[]>>({});
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [paiement, setPaiement] = useState('');
  const [message, setMessage] = useState<EtatMessage>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (b) => ({
      achat: await b.premier<AchatSync & { fournisseur: string | null }>(
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
        <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      </Ecran>
    );
  }
  const actif = achat.statut === 'BROUILLON' || achat.statut === 'PARTIEL';
  const reste = achat.montantTotal - achat.montantPaye;
  const rienRecu = lignes.every((l) => l.quantiteRecue === 0);

  const executer = async (action: () => Promise<void>, succes: string) => {
    setMessage(null);
    setEnvoi(true);
    try {
      await action();
      setMessage({ texte: succes, type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const recevoir = () =>
    executer(async () => {
      const receptions = lignes.flatMap<ReceptionSaisie['lignes'][number]>((l) => {
        if (l.type === 'TELEPHONE') {
          const liste = imeis[l.id] ?? [];
          return liste.length
            ? [
                {
                  ligneId: l.id,
                  articles: liste.map((imei) => ({ id: Crypto.randomUUID(), imei })),
                },
              ]
            : [];
        }
        const q = Number((quantites[l.id] ?? '').replace(/\s/g, ''));
        return Number.isInteger(q) && q > 0 ? [{ ligneId: l.id, quantite: q }] : [];
      });
      if (!receptions.length) throw new Error('Scannez des IMEI ou indiquez les quantités reçues.');
      await enregistrer({
        type: 'ACHAT_RECEVOIR',
        boutiqueId: boutique.id,
        contenu: { achatId: achat.id, lignes: receptions },
      });
      setImeis({});
      setQuantites({});
    }, 'Réception enregistrée : le stock est à jour.');

  const payer = () =>
    executer(async () => {
      const montant = Number(paiement.replace(/[\s ]/g, ''));
      if (!Number.isInteger(montant) || montant <= 0)
        throw new Error('Montant : nombre entier positif attendu.');
      await enregistrer({
        type: 'ACHAT_PAYER',
        boutiqueId: boutique.id,
        contenu: { achatId: achat.id, montant },
      });
      setPaiement('');
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
      </Carte>
      <Message texte={message?.texte ?? null} type={message?.type} />

      {lignes.map((l) => {
        const attendu = l.quantite - l.quantiteRecue;
        return (
          <Carte key={l.id}>
            <Texte gras>{l.nom}</Texte>
            <Texte discret>
              Reçu {l.quantiteRecue} / {l.quantite} · {formaterMontant(l.prixAchat, monnaie)}{' '}
              l’unité
            </Texte>
            {actif && attendu > 0 ? (
              l.type === 'TELEPHONE' ? (
                <SaisieImei
                  libelle="IMEI reçus"
                  imeis={imeis[l.id] ?? []}
                  surChangement={(liste) => setImeis((i) => ({ ...i, [l.id]: liste }))}
                  dejaConnu={(imei) => imeisConnus.has(imei)}
                  maximum={attendu}
                />
              ) : (
                <View style={{ gap: 4 }}>
                  <Text style={{ color: colors.text }}>Quantité reçue (attendu : {attendu})</Text>
                  <TextInput
                    value={quantites[l.id] ?? ''}
                    onChangeText={(t) => setQuantites((q) => ({ ...q, [l.id]: t }))}
                    keyboardType="number-pad"
                    accessibilityLabel={`Quantité reçue de ${l.nom}`}
                    style={{
                      borderWidth: 1,
                      borderRadius: 8,
                      borderColor: colors.border,
                      color: colors.text,
                      padding: 10,
                      fontSize: 16,
                    }}
                  />
                </View>
              )
            ) : null}
          </Carte>
        );
      })}

      {actif ? (
        <Bouton titre="Valider la réception" onPress={() => void recevoir()} chargement={envoi} />
      ) : null}
      {achat.statut !== 'ANNULE' && reste > 0 ? (
        <Carte>
          <Champ
            libelle="Paiement au fournisseur"
            value={paiement}
            onChangeText={setPaiement}
            keyboardType="number-pad"
          />
          <Bouton
            titre="Enregistrer le paiement"
            variante="secondaire"
            onPress={() => void payer()}
            chargement={envoi}
          />
        </Carte>
      ) : null}
      {achat.statut === 'BROUILLON' ? (
        <Bouton
          titre="Modifier le bon"
          variante="secondaire"
          onPress={() => router.push({ pathname: '/achat/edition', params: { id: achat.id } })}
        />
      ) : null}
      {actif && rienRecu ? (
        <Bouton titre="Annuler le bon" variante="danger" onPress={() => void annuler()} />
      ) : null}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
