import {
  type ClientSync,
  formaterTelephone,
  type GarantSync,
  LIBELLES_PIECES,
  normaliserTelephone,
  peutGererSessions,
  schemaClient,
  type TypePiece,
  TYPES_PIECES,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { clientsAvecTelephone } from '@/lib/clients';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

const OPTIONS_PIECES = TYPES_PIECES.map((t) => ({ id: t, nom: LIBELLES_PIECES[t] }));

/** Création (sans id) ou modification d'une fiche client, avec son garant. */
export default function EditionClient() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const donnees = useLecture(
    async (base) => ({
      client: id ? await base.premier<ClientSync>('SELECT * FROM client WHERE id = ?', [id]) : null,
      garant: id
        ? await base.premier<GarantSync>('SELECT * FROM garant WHERE clientId = ?', [id])
        : null,
    }),
    [id],
  );
  if (!donnees)
    return (
      <Ecran titre="Fiche client" enHaut>
        {null}
      </Ecran>
    );
  if (id && !donnees.client) {
    return (
      <Ecran titre="Fiche client" enHaut>
        <Message texte="Client introuvable." />
      </Ecran>
    );
  }
  return <Formulaire client={donnees.client} garant={donnees.garant} />;
}

const texte = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : String(v);

function Formulaire({ client, garant }: { client: ClientSync | null; garant: GarantSync | null }) {
  const { profil, boutique } = useSession();
  const { enregistrer, base } = useSync();
  const indicatif = profil?.commerce.indicatif ?? '+224';
  const proprietaire = profil?.role === 'PROPRIETAIRE';
  const gestion = !!profil && peutGererSessions(profil.role);

  const [nom, setNom] = useState(client?.nom ?? '');
  const [telephone, setTelephone] = useState(
    client ? formaterTelephone(client.telephone, indicatif) : '',
  );
  const [type, setType] = useState<'DETAIL' | 'GROSSISTE'>(client?.type ?? 'DETAIL');
  const [typePiece, setTypePiece] = useState<TypePiece | null>(client?.typePiece ?? null);
  const [numeroPiece, setNumeroPiece] = useState(client?.numeroPiece ?? '');
  const [adresse, setAdresse] = useState(client?.adresse ?? '');
  const [plafond, setPlafond] = useState(texte(client?.plafondCredit));
  const [archive, setArchive] = useState(client?.archive ?? false);
  const [avecGarant, setAvecGarant] = useState(!!garant);
  const [gNom, setGNom] = useState(garant?.nom ?? '');
  const [gTelephone, setGTelephone] = useState(
    garant ? formaterTelephone(garant.telephone, indicatif) : '',
  );
  const [gLien, setGLien] = useState(garant?.lien ?? '');
  const [gTypePiece, setGTypePiece] = useState<TypePiece | null>(garant?.typePiece ?? null);
  const [gNumeroPiece, setGNumeroPiece] = useState(garant?.numeroPiece ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const numero = normaliserTelephone(telephone, indicatif);
  // Doublon de téléphone : signalé, pas bloquant (une famille peut partager un numéro).
  const doublons = useLecture(
    async (b) => (numero ? clientsAvecTelephone(b, numero, client?.id ?? null) : []),
    [numero, client?.id],
  );

  const enregistrerFiche = async () => {
    setErreur(null);
    if (!numero) {
      setErreur(
        `Numéro de téléphone invalide. Exemple : 620 11 22 33 (l’indicatif ${indicatif} est ajouté).`,
      );
      return;
    }
    const gNumero = avecGarant ? normaliserTelephone(gTelephone, indicatif) : null;
    if (avecGarant && !gNumero) {
      setErreur('Numéro de téléphone du garant invalide.');
      return;
    }
    const montant = plafond.replace(/[\s ]/g, '');
    if (montant && !/^\d+$/.test(montant)) {
      setErreur('Plafond de crédit : nombre entier attendu.');
      return;
    }
    const saisie = schemaClient.safeParse({
      id: client?.id ?? Crypto.randomUUID(),
      nom,
      telephone: numero,
      type,
      typePiece,
      numeroPiece: numeroPiece.trim() || null,
      adresse: adresse.trim() || null,
      plafondCredit: montant ? Number(montant) : null,
      archive,
      garant: avecGarant
        ? {
            id: garant?.id ?? Crypto.randomUUID(),
            nom: gNom,
            telephone: gNumero,
            typePiece: gTypePiece,
            numeroPiece: gNumeroPiece.trim() || null,
            adresse: null,
            lien: gLien.trim() || null,
          }
        : null,
    });
    if (!saisie.success) {
      setErreur(saisie.error.issues.map((i) => i.message).join('\n'));
      return;
    }
    if (!boutique || !base) return;
    setEnvoi(true);
    try {
      await enregistrer({
        type: 'CLIENT_ENREGISTRER',
        boutiqueId: boutique.id,
        contenu: saisie.data,
      });
      router.replace({ pathname: '/client/[id]', params: { id: saisie.data.id } });
    } catch (e) {
      setErreur((e as Error).message);
      setEnvoi(false);
    }
  };

  return (
    <Ecran titre={client ? 'Modifier le client' : 'Nouveau client'} enHaut>
      <Champ libelle="Nom et prénom" value={nom} onChangeText={setNom} autoCapitalize="words" />
      <Champ
        libelle={`Téléphone (indicatif ${indicatif} ajouté si absent)`}
        value={telephone}
        onChangeText={setTelephone}
        keyboardType="phone-pad"
        placeholder="620 11 22 33"
      />
      {doublons?.length ? (
        <Message
          type="info"
          texte={`Ce numéro est déjà celui de : ${doublons.map((d) => d.nom).join(', ')}. Vérifiez qu’il ne s’agit pas du même client.`}
        />
      ) : null}
      {gestion ? (
        <Choix
          libelle="Type de client"
          options={[
            { id: 'DETAIL', nom: 'Détail' },
            { id: 'GROSSISTE', nom: 'Grossiste (prix de gros)' },
          ]}
          valeurs={[type]}
          surChoix={([t]) => t && setType(t as 'DETAIL' | 'GROSSISTE')}
        />
      ) : (
        <Texte discret>
          Type : {type === 'GROSSISTE' ? 'grossiste' : 'détail'} (modifiable par le gérant)
        </Texte>
      )}
      <Choix
        libelle="Pièce d’identité"
        options={OPTIONS_PIECES}
        valeurs={typePiece ? [typePiece] : []}
        aucun="Aucune"
        surChoix={([t]) => setTypePiece((t as TypePiece) ?? null)}
      />
      {typePiece ? (
        <Champ libelle="Numéro de la pièce" value={numeroPiece} onChangeText={setNumeroPiece} />
      ) : null}
      <Champ libelle="Adresse" value={adresse} onChangeText={setAdresse} />
      {proprietaire ? (
        <Champ
          libelle="Plafond de crédit (vide : pas de crédit)"
          value={plafond}
          onChangeText={setPlafond}
          keyboardType="number-pad"
        />
      ) : (
        <Texte discret>Plafond de crédit : fixé par le propriétaire.</Texte>
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: avecGarant }}
        onPress={() => setAvecGarant((g) => !g)}
      >
        <Texte>{avecGarant ? '☑' : '☐'} Un garant se porte caution</Texte>
      </Pressable>
      {avecGarant ? (
        <Carte>
          <Champ
            libelle="Nom du garant"
            value={gNom}
            onChangeText={setGNom}
            autoCapitalize="words"
          />
          <Champ
            libelle="Téléphone du garant"
            value={gTelephone}
            onChangeText={setGTelephone}
            keyboardType="phone-pad"
          />
          <Champ
            libelle="Lien avec le client"
            value={gLien}
            onChangeText={setGLien}
            placeholder="Frère, employeur…"
          />
          <Choix
            libelle="Pièce du garant"
            options={OPTIONS_PIECES}
            valeurs={gTypePiece ? [gTypePiece] : []}
            aucun="Aucune"
            surChoix={([t]) => setGTypePiece((t as TypePiece) ?? null)}
          />
          {gTypePiece ? (
            <Champ libelle="Numéro" value={gNumeroPiece} onChangeText={setGNumeroPiece} />
          ) : null}
        </Carte>
      ) : null}

      {client ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: archive }}
          onPress={() => setArchive((a) => !a)}
        >
          <Texte>{archive ? '☑' : '☐'} Archivé (n’apparaît plus dans la liste)</Texte>
        </Pressable>
      ) : null}
      <Message texte={erreur} />
      <Bouton titre="Enregistrer" onPress={() => void enregistrerFiche()} chargement={envoi} />
      <Bouton titre="Annuler" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
