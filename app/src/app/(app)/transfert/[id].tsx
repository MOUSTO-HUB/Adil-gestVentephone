import {
  bilanReception,
  formaterDate,
  LIBELLES_STATUTS_TRANSFERT,
  peutGererSessions,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { SaisieImei } from '@/components/saisie-imei';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';
import { boutiquesDuCommerce, detailTransfert } from '@/lib/transferts';

/**
 * Fiche d'un transfert : préparation et envoi par scan (départ), réception par scan
 * avec écarts (arrivée), annulation. Tout fonctionne hors ligne.
 */
export default function FicheTransfert() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCouleurs();
  const { profil, boutique, api } = useSession();
  const { enregistrer } = useSync();
  const [imeis, setImeis] = useState<string[]>([]);
  const [quantites, setQuantites] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [motif, setMotif] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const boutiqueId = boutique?.id ?? '';

  const detail = useLecture((b) => detailTransfert(b, id), [id]);
  const boutiques = useLecture(
    (b) => boutiquesDuCommerce(b, api, profil?.boutiques ?? []),
    [api, profil?.boutiques],
  );
  const enStock = useLecture(
    async (b) =>
      new Map(
        (
          await b.tous<{ id: string; imei: string; produitId: string }>(
            "SELECT id, imei, produitId FROM article WHERE boutiqueId = ? AND statut = 'EN_STOCK'",
            [boutiqueId],
          )
        ).map((a) => [a.imei, a]),
      ),
    [boutiqueId],
  );

  if (!profil || !boutique || !detail) {
    return (
      <Ecran titre="Transfert" enHaut>
        {detail === null ? <Message texte="Transfert introuvable sur cet appareil." /> : null}
      </Ecran>
    );
  }
  const { transfert: t, lignes } = detail;
  const nom = (bid: string) => boutiques?.find((b) => b.id === bid)?.nom ?? 'autre boutique';
  const fuseau = profil.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const gestion = peutGererSessions(profil.role);
  const auDepart = t.boutiqueDepartId === boutiqueId;
  const aLArrivee = t.boutiqueArriveeId === boutiqueId;
  const aPreparer = t.statut === 'DEMANDE' && auDepart && gestion;
  const aRecevoir = t.statut === 'ENVOYE' && aLArrivee;
  const annulable = gestion && (t.statut === 'DEMANDE' || (t.statut === 'ENVOYE' && auDepart));
  const accessoires = lignes.filter((l) => l.type === 'ACCESSOIRE');
  const produitsTelephones = new Set(
    lignes.filter((l) => l.type === 'TELEPHONE').map((l) => l.produitId),
  );
  const quantite = (ligneId: string, defaut: number) => {
    const brut = quantites[ligneId];
    return brut === undefined ? defaut : Number(brut);
  };

  const agir = async (tache: () => Promise<void>, succes: string) => {
    setMessage(null);
    setEnvoi(true);
    try {
      await tache();
      setMessage({ texte: succes, type: 'succes' });
      setImeis([]);
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const preparer = () => {
    const telephones = imeis.map((imei) => enStock!.get(imei)!);
    const acc = accessoires
      .map((l) => ({ l, n: quantite(l.id, Math.min(l.quantite, l.disponible)) }))
      .filter((x) => x.n > 0);
    if (acc.some((x) => !Number.isInteger(x.n) || x.n > x.l.disponible)) {
      return setMessage({ texte: 'Quantité invalide ou supérieure au stock.', type: 'erreur' });
    }
    if (!telephones.length && !acc.length) {
      return setMessage({ texte: 'Rien à envoyer : scannez ou comptez.', type: 'erreur' });
    }
    void agir(
      () =>
        enregistrer({
          type: 'TRANSFERT_ENVOYER',
          boutiqueId,
          contenu: {
            id: t.id,
            numero: t.numero,
            boutiqueArriveeId: t.boutiqueArriveeId,
            note: t.note,
            lignes: [
              ...telephones.map((a) => ({
                id: Crypto.randomUUID(),
                produitId: a.produitId,
                articleId: a.id,
                quantite: 1,
              })),
              ...acc.map((x) => ({
                id: Crypto.randomUUID(),
                produitId: x.l.produitId,
                articleId: null,
                quantite: x.n,
              })),
            ],
          },
        }),
      'Transfert envoyé : le stock de la boutique a diminué.',
    );
  };

  const attendus = new Map(
    lignes.flatMap((l) => (l.imei && l.articleId ? [[l.imei, l.articleId] as const] : [])),
  );
  const reception = {
    quantites: accessoires.map((l) => ({ ligneId: l.id, quantite: quantite(l.id, l.quantite) })),
    articlesRecus: imeis.flatMap((imei) => (attendus.has(imei) ? [attendus.get(imei)!] : [])),
  };
  const bilan = aRecevoir ? bilanReception(lignes, reception) : null;

  const recevoir = () => {
    if (reception.quantites.some((q) => !Number.isInteger(q.quantite) || q.quantite < 0)) {
      return setMessage({ texte: 'Quantités : nombres entiers.', type: 'erreur' });
    }
    void agir(
      () =>
        enregistrer({
          type: 'TRANSFERT_RECEVOIR',
          boutiqueId,
          contenu: {
            transfertId: t.id,
            recuLe: new Date().toISOString(),
            ...reception,
            note: note.trim() || null,
          },
        }),
      bilan?.ecarts.length
        ? 'Réception enregistrée avec écarts : le gérant est prévenu par le journal.'
        : 'Réception enregistrée : tout est entré en stock.',
    );
  };

  const annuler = () => {
    if (motif.trim().length < 3) return setMessage({ texte: 'Indiquez le motif.', type: 'erreur' });
    void agir(
      () =>
        enregistrer({
          type: 'TRANSFERT_ANNULER',
          boutiqueId,
          contenu: { transfertId: t.id, motif: motif.trim() },
        }),
      'Transfert annulé.',
    );
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Ecran titre={`Transfert ${t.numero}`} sousTitre={LIBELLES_STATUTS_TRANSFERT[t.statut]} enHaut>
      <Carte
        titre={`${nom(t.boutiqueDepartId)} → ${nom(t.boutiqueArriveeId)}`}
        icone="swap-horizontal"
      >
        <Texte discret>
          Créé le {formaterDate(t.creeLe, fuseau, true)}
          {t.envoyeLe ? ` · envoyé le ${formaterDate(t.envoyeLe, fuseau, true)}` : ''}
          {t.recuLe ? ` · reçu le ${formaterDate(t.recuLe, fuseau, true)}` : ''}
        </Texte>
        {t.note ? <Texte>{t.note}</Texte> : null}
        {t.noteReception ? <Texte>Réception : {t.noteReception}</Texte> : null}
        {lignes.map((l) => (
          <View key={l.id} style={styles.ligne}>
            <View style={{ flex: 1 }}>
              <Texte>{l.produit}</Texte>
              {l.imei ? <Texte discret>IMEI {l.imei}</Texte> : null}
            </View>
            <Texte gras>
              {l.quantiteRecue !== null ? `${l.quantiteRecue} / ${l.quantite}` : `× ${l.quantite}`}
            </Texte>
          </View>
        ))}
        {t.statut === 'RECU' && lignes.some((l) => (l.quantiteRecue ?? 0) < l.quantite) ? (
          <Message texte="Écart à la réception : des articles envoyés n’ont pas été reçus." />
        ) : null}
      </Carte>

      <Message texte={message?.texte ?? null} type={message?.type} />

      {aPreparer ? (
        <Carte titre="Préparer l’envoi" icone="paper-plane">
          {produitsTelephones.size ? (
            <SaisieImei
              libelle="Téléphones scannés"
              imeis={imeis}
              surChangement={setImeis}
              refus={(imei) => {
                const a = enStock?.get(imei);
                if (!a) return `${imei} n’est pas en stock dans cette boutique.`;
                return produitsTelephones.has(a.produitId) ? null : `${imei} : modèle non demandé.`;
              }}
            />
          ) : null}
          {accessoires.map((l) => (
            <View key={l.id} style={styles.ligne}>
              <View style={{ flex: 1 }}>
                <Texte>{l.produit}</Texte>
                <Texte discret>
                  Demandé {l.quantite} · {l.disponible} en stock
                </Texte>
              </View>
              <TextInput
                value={quantites[l.id] ?? String(Math.min(l.quantite, l.disponible))}
                onChangeText={(v) => setQuantites((q) => ({ ...q, [l.id]: v }))}
                keyboardType="number-pad"
                accessibilityLabel={`Quantité envoyée de ${l.produit}`}
                style={[saisie, { width: 80 }]}
              />
            </View>
          ))}
          <Bouton titre="Envoyer" icone="paper-plane" onPress={preparer} chargement={envoi} />
        </Carte>
      ) : null}

      {aRecevoir ? (
        <Carte titre="Réceptionner" icone="download">
          {attendus.size ? (
            <SaisieImei
              libelle="Téléphones reçus (scan)"
              imeis={imeis}
              surChangement={setImeis}
              maximum={attendus.size}
              refus={(imei) =>
                attendus.has(imei) ? null : `${imei} ne fait pas partie de ce transfert.`
              }
            />
          ) : null}
          {accessoires.map((l) => (
            <View key={l.id} style={styles.ligne}>
              <View style={{ flex: 1 }}>
                <Texte>{l.produit}</Texte>
                <Texte discret>Envoyé {l.quantite}</Texte>
              </View>
              <TextInput
                value={quantites[l.id] ?? String(l.quantite)}
                onChangeText={(v) => setQuantites((q) => ({ ...q, [l.id]: v }))}
                keyboardType="number-pad"
                accessibilityLabel={`Quantité reçue de ${l.produit}`}
                style={[saisie, { width: 80 }]}
              />
            </View>
          ))}
          {bilan?.ecarts.length ? (
            <Message
              type="info"
              texte={`${bilan.ecarts.length} écart(s) : ${bilan.ecarts
                .map((e) => {
                  const l = lignes.find((x) => x.id === e.ligneId)!;
                  return `${l.produit}${l.imei ? ` (${l.imei})` : ''} ${e.recu}/${e.envoye}`;
                })
                .join(', ')}.`}
            />
          ) : null}
          <Champ libelle="Remarque (écarts, casse…)" value={note} onChangeText={setNote} />
          <Bouton
            titre="Confirmer la réception"
            icone="checkmark-circle"
            onPress={recevoir}
            chargement={envoi}
          />
        </Carte>
      ) : null}

      {t.statut === 'DEMANDE' && aLArrivee ? (
        <Message type="info" texte={`En attente de préparation par ${nom(t.boutiqueDepartId)}.`} />
      ) : null}
      {t.statut === 'ENVOYE' && auDepart ? (
        <Message
          type="info"
          texte={`En route : ${nom(t.boutiqueArriveeId)} confirmera la réception.`}
        />
      ) : null}

      {annulable ? (
        <Carte titre="Annuler le transfert" icone="close-circle">
          <Champ libelle="Motif" value={motif} onChangeText={setMotif} />
          <Bouton
            titre="Annuler le transfert"
            variante="danger"
            onPress={annuler}
            chargement={envoi}
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
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
