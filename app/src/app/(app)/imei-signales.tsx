import {
  LIBELLES_MOTIFS_IMEI,
  MOTIFS_IMEI_SIGNALE,
  type MotifImeiSignale,
  normaliserImei,
  peutGererSessions,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

interface Signalement {
  id: string;
  imei: string;
  motif: MotifImeiSignale;
  note: string | null;
  actif: number;
}

/**
 * IMEI signalés volés ou bloqués (saisis par le commerce) : la reprise d'un de ces
 * appareils est refusée à la saisie du troc, même hors ligne, et par le serveur.
 */
export default function ImeiSignales() {
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const [imei, setImei] = useState('');
  const [motif, setMotif] = useState<MotifImeiSignale>('VOLE');
  const [note, setNote] = useState('');
  const [recherche, setRecherche] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const gestion = !!profil && peutGererSessions(profil.role);
  const filtre = normaliserImei(recherche);

  const liste = useLecture(
    (b) =>
      b.tous<Signalement>(
        `SELECT id, imei, motif, note, actif FROM imeiSignale
          WHERE ? = '' OR imei LIKE ?
          ORDER BY actif DESC, imei LIMIT 200`,
        [filtre, `%${filtre}%`],
      ),
    [filtre],
  );

  if (!profil || !boutique)
    return (
      <Ecran titre="IMEI signalés" enHaut>
        {null}
      </Ecran>
    );

  const signaler = async (s: Omit<Signalement, 'actif'> & { actif: boolean }) => {
    setMessage(null);
    try {
      await enregistrer({ type: 'IMEI_SIGNALER', boutiqueId: boutique.id, contenu: s });
      return true;
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
      return false;
    }
  };

  const ajouter = async () => {
    const saisi = normaliserImei(imei);
    if (!/^\d{14,16}$/.test(saisi)) {
      return setMessage({ texte: 'IMEI : 14 à 16 chiffres.', type: 'erreur' });
    }
    const ok = await signaler({
      id: Crypto.randomUUID(),
      imei: saisi,
      motif,
      note: note.trim() || null,
      actif: true,
    });
    if (ok) {
      setMessage({ texte: `IMEI ${saisi} signalé.`, type: 'info' });
      setImei('');
      setNote('');
    }
  };

  const saisie = [
    styles.saisie,
    { color: c.texte, borderColor: c.bordure, backgroundColor: c.carte },
  ];

  return (
    <Ecran titre="IMEI signalés" sousTitre="Téléphones volés ou bloqués" enHaut>
      <Message texte={message?.texte ?? null} type={message?.type} />
      {gestion ? (
        <Carte titre="Signaler un IMEI" icone="warning">
          <TextInput
            value={imei}
            onChangeText={setImei}
            placeholder="IMEI"
            placeholderTextColor={c.texteDiscret}
            keyboardType="number-pad"
            maxLength={20}
            accessibilityLabel="IMEI à signaler"
            style={saisie}
          />
          <Choix
            libelle="Motif"
            options={MOTIFS_IMEI_SIGNALE.map((id) => ({ id, nom: LIBELLES_MOTIFS_IMEI[id] }))}
            valeurs={[motif]}
            surChoix={([v]) => v && setMotif(v as MotifImeiSignale)}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Note (plainte, propriétaire, opérateur…)"
            placeholderTextColor={c.texteDiscret}
            maxLength={200}
            style={saisie}
          />
          <Bouton titre="Signaler" icone="alert-circle" onPress={() => void ajouter()} />
        </Carte>
      ) : (
        <Message
          type="info"
          texte="Un téléphone de cette liste ne peut pas être repris. Le gérant tient la liste."
        />
      )}
      <TextInput
        value={recherche}
        onChangeText={setRecherche}
        placeholder="Chercher un IMEI"
        placeholderTextColor={c.texteDiscret}
        keyboardType="number-pad"
        accessibilityLabel="Chercher un IMEI signalé"
        style={saisie}
      />
      {liste?.length === 0 ? <Texte discret>Aucun IMEI signalé.</Texte> : null}
      {liste?.map((s) => (
        <Carte key={s.id}>
          <Texte gras>
            {s.imei} · {LIBELLES_MOTIFS_IMEI[s.motif]}
            {s.actif ? '' : ' (levé)'}
          </Texte>
          {s.note ? <Texte discret>{s.note}</Texte> : null}
          {gestion ? (
            <Bouton
              titre={s.actif ? 'Lever le signalement' : 'Signaler de nouveau'}
              variante="secondaire"
              onPress={() => void signaler({ ...s, actif: !s.actif })}
            />
          ) : null}
        </Carte>
      ))}
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
