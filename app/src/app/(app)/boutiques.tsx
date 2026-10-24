import { normaliserTelephone } from '@gestvente/commun';
import { useState } from 'react';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { type Boutique, messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Boutiques du commerce (propriétaire) : création sans limite, nom et coordonnées.
 * Le préfixe des factures ne change plus une fois créé (numéros déjà émis).
 */
export default function Boutiques() {
  const { profil, boutique: active, api, rafraichirProfil, choisirBoutique } = useSession();
  const [nom, setNom] = useState('');
  const [prefixe, setPrefixe] = useState('');
  const [adresse, setAdresse] = useState('');
  const [telephone, setTelephone] = useState('');
  const [edition, setEdition] = useState<{
    id: string;
    nom: string;
    adresse: string;
    telephone: string;
  } | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'succes' } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  if (!profil)
    return (
      <Ecran titre="Boutiques" enHaut>
        {null}
      </Ecran>
    );
  if (profil.role !== 'PROPRIETAIRE') {
    return (
      <Ecran titre="Boutiques" enHaut>
        <Message texte="Les boutiques sont gérées par le propriétaire." />
      </Ecran>
    );
  }

  const telephoneSaisi = (texte: string) => {
    if (!texte.trim()) return undefined;
    const numero = normaliserTelephone(texte, profil.commerce.indicatif);
    if (!numero) throw new Error('Numéro de téléphone invalide.');
    return numero;
  };

  const creer = async () => {
    setMessage(null);
    if (nom.trim().length < 2 || !/^[A-Za-z]{2,5}$/.test(prefixe.trim())) {
      return setMessage({
        texte: 'Nom de la boutique et préfixe des factures (2 à 5 lettres) obligatoires.',
        type: 'erreur',
      });
    }
    setEnvoi(true);
    try {
      const creee = await api.requete<{ nom: string }>('/boutiques', {
        methode: 'POST',
        corps: {
          nom: nom.trim(),
          prefixe: prefixe.trim().toUpperCase(),
          adresse: adresse.trim() || undefined,
          telephone: telephoneSaisi(telephone),
        },
      });
      await rafraichirProfil();
      setNom('');
      setPrefixe('');
      setAdresse('');
      setTelephone('');
      setMessage({
        texte: `Boutique « ${creee.nom} » créée. Rattachez-y des employés dans « Équipe ».`,
        type: 'succes',
      });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const enregistrer = async () => {
    if (!edition) return;
    setMessage(null);
    setEnvoi(true);
    try {
      await api.requete(`/boutiques/${edition.id}`, {
        methode: 'PATCH',
        corps: {
          nom: edition.nom.trim(),
          adresse: edition.adresse.trim(),
          telephone: telephoneSaisi(edition.telephone),
        },
      });
      await rafraichirProfil();
      setEdition(null);
      setMessage({ texte: 'Boutique modifiée.', type: 'succes' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const ouvrir = (b: Boutique) =>
    setEdition({
      id: b.id,
      nom: b.nom,
      adresse: b.adresse ?? '',
      telephone: b.telephone ?? '',
    });

  return (
    <Ecran titre="Boutiques" sousTitre={`${profil.boutiques.length} boutique(s)`} enHaut>
      <Message texte={message?.texte ?? null} type={message?.type} />
      {profil.boutiques.map((b) =>
        edition?.id === b.id ? (
          <Carte key={b.id} titre={`Modifier ${b.nom} (${b.prefixe})`} icone="create">
            <Champ
              libelle="Nom"
              value={edition.nom}
              onChangeText={(v) => setEdition({ ...edition, nom: v })}
            />
            <Champ
              libelle="Adresse"
              value={edition.adresse}
              onChangeText={(v) => setEdition({ ...edition, adresse: v })}
            />
            <Champ
              libelle="Téléphone"
              value={edition.telephone}
              keyboardType="phone-pad"
              onChangeText={(v) => setEdition({ ...edition, telephone: v })}
            />
            <Bouton
              titre="Enregistrer"
              icone="save"
              onPress={() => void enregistrer()}
              chargement={envoi}
            />
            <Bouton titre="Annuler" variante="secondaire" onPress={() => setEdition(null)} />
          </Carte>
        ) : (
          <Carte key={b.id} titre={`${b.nom} (${b.prefixe})`} icone="storefront">
            <Texte discret>
              {[b.adresse, b.telephone].filter(Boolean).join(' · ') || 'Sans adresse'}
              {active?.id === b.id ? ' · boutique active sur cet appareil' : ''}
            </Texte>
            <Bouton
              titre="Modifier"
              variante="secondaire"
              icone="create-outline"
              onPress={() => ouvrir(b)}
            />
            {active?.id !== b.id ? (
              <Bouton
                titre="Travailler dans cette boutique"
                variante="secondaire"
                icone="swap-horizontal"
                onPress={() => void choisirBoutique(b)}
              />
            ) : null}
          </Carte>
        ),
      )}
      <Carte titre="Nouvelle boutique" icone="add-circle">
        <Champ libelle="Nom" value={nom} onChangeText={setNom} placeholder="Adil Phone Kaloum" />
        <Champ
          libelle="Préfixe des factures (2 à 5 lettres, définitif)"
          value={prefixe}
          onChangeText={setPrefixe}
          autoCapitalize="characters"
          maxLength={5}
          placeholder="KAL"
        />
        <Champ libelle="Adresse (facultatif)" value={adresse} onChangeText={setAdresse} />
        <Champ
          libelle="Téléphone (facultatif)"
          value={telephone}
          onChangeText={setTelephone}
          keyboardType="phone-pad"
        />
        <Bouton
          titre="Créer la boutique"
          icone="add"
          onPress={() => void creer()}
          chargement={envoi}
        />
      </Carte>
    </Ecran>
  );
}
