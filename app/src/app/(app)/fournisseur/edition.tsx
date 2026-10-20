import { type FournisseurSync, normaliserTelephone, schemaFournisseur } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Bouton, Champ, Ecran, Message, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

/** Création (sans id) ou modification d'un fournisseur. */
export default function EditionFournisseur() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const fournisseur = useLecture(
    async (b) =>
      id ? b.premier<FournisseurSync>('SELECT * FROM fournisseur WHERE id = ?', [id]) : null,
    [id],
  );
  if (fournisseur === undefined)
    return (
      <Ecran titre="Fournisseur" enHaut>
        {null}
      </Ecran>
    );
  return <Formulaire fournisseur={fournisseur} />;
}

function Formulaire({ fournisseur }: { fournisseur: FournisseurSync | null }) {
  const { profil, boutique } = useSession();
  const { enregistrer } = useSync();
  const indicatif = profil?.commerce.indicatif ?? '+224';
  const [nom, setNom] = useState(fournisseur?.nom ?? '');
  const [telephone, setTelephone] = useState(fournisseur?.telephone ?? '');
  const [adresse, setAdresse] = useState(fournisseur?.adresse ?? '');
  const [note, setNote] = useState(fournisseur?.note ?? '');
  const [archive, setArchive] = useState(fournisseur?.archive ?? false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const valider = async () => {
    setErreur(null);
    const numero = telephone.trim() ? normaliserTelephone(telephone, indicatif) : null;
    if (telephone.trim() && !numero) {
      setErreur(
        'Numéro de téléphone invalide (indicatif international pour l’étranger, ex. +971…).',
      );
      return;
    }
    const saisie = schemaFournisseur.safeParse({
      id: fournisseur?.id ?? Crypto.randomUUID(),
      nom,
      telephone: numero,
      adresse: adresse.trim() || null,
      note: note.trim() || null,
      archive,
    });
    if (!saisie.success) {
      setErreur(saisie.error.issues.map((i) => i.message).join('\n'));
      return;
    }
    if (!boutique) return;
    setEnvoi(true);
    try {
      await enregistrer({
        type: 'FOURNISSEUR_ENREGISTRER',
        boutiqueId: boutique.id,
        contenu: saisie.data,
      });
      router.replace({ pathname: '/fournisseur/[id]', params: { id: saisie.data.id } });
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  };

  return (
    <Ecran titre={fournisseur ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} enHaut>
      <Champ libelle="Nom" value={nom} onChangeText={setNom} />
      <Champ
        libelle="Téléphone"
        value={telephone}
        onChangeText={setTelephone}
        keyboardType="phone-pad"
      />
      <Champ libelle="Adresse" value={adresse} onChangeText={setAdresse} />
      <Champ libelle="Note" value={note} onChangeText={setNote} multiline />
      {fournisseur ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: archive }}
          onPress={() => setArchive((a) => !a)}
        >
          <Texte>{archive ? '☑' : '☐'} Archivé</Texte>
        </Pressable>
      ) : null}
      <Message texte={erreur} />
      <Bouton titre="Enregistrer" onPress={() => void valider()} chargement={envoi} />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
