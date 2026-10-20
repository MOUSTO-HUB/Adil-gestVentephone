import {
  CATEGORIES_DEPENSE,
  type CategorieDepense,
  type DepenseSync,
  formaterMontant,
  LIBELLES_CATEGORIES_DEPENSE,
  LIBELLES_MOYENS,
  MOYENS_REMBOURSEMENT,
  type MoyenRemboursement,
  peutGererSessions,
} from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { type ClientApi, ErreurApi, messageErreur } from '@/lib/api';
import { caisseOuverte } from '@/lib/caisse-session';
import { choisirPhoto, envoyerImage, lireImagePrivee } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

const entier = (texte: string) => {
  const propre = texte.replace(/[\s ]/g, '');
  return /^\d+$/.test(propre) ? Number(propre) : Number.NaN;
};
const options = <T extends string>(valeurs: readonly T[], libelles: Record<T, string>) =>
  valeurs.map((id) => ({ id, nom: libelles[id] }));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Envoie le justificatif dès que la dépense est arrivée sur le serveur (quelques essais). */
async function envoyerJustificatif(api: ClientApi, depenseId: string, uri: string) {
  for (let essai = 0; ; essai++) {
    try {
      await envoyerImage(api, `/depenses/${depenseId}/justificatif`, uri);
      return;
    } catch (e) {
      if (!(e instanceof ErreurApi && e.statut === 404) || essai >= 4) throw e;
      await pause(1500);
    }
  }
}

/**
 * Dépenses de la boutique : catégorie, montant, payée depuis la caisse ou non,
 * photo du justificatif (envoyée en ligne).
 */
export default function Depenses() {
  const { profil, boutique, api } = useSession();
  const { enregistrer } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const boutiqueId = boutique?.id ?? '';
  const gestion = !!profil && peutGererSessions(profil.role);
  const [categorie, setCategorie] = useState<CategorieDepense>('TRANSPORT');
  const [libelle, setLibelle] = useState('');
  const [montant, setMontant] = useState('');
  const [moyen, setMoyen] = useState<MoyenRemboursement>('ESPECES');
  const [depuisCaisse, setDepuisCaisse] = useState(true);
  const [photo, setPhoto] = useState<string | null>(null);
  const [apercu, setApercu] = useState<{ id: string; image: string } | null>(null);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const donnees = useLecture(
    async (b) => {
      const debut = new Date();
      debut.setDate(debut.getDate() - 30);
      return {
        caisse: profil ? await caisseOuverte(b, boutiqueId, profil.id) : null,
        depenses: await b.tous<DepenseSync>(
          `SELECT * FROM depense WHERE boutiqueId = ? AND dateDepense >= ?
              AND (? = 1 OR creeParId = ?)
            ORDER BY dateDepense DESC LIMIT 100`,
          [boutiqueId, debut.toISOString(), gestion ? 1 : 0, profil?.id ?? ''],
        ),
      };
    },
    [boutiqueId, profil?.id, gestion],
  );
  if (!profil || !boutique || !donnees) {
    return (
      <Ecran titre="Dépenses" enHaut>
        {null}
      </Ecran>
    );
  }
  const { caisse, depenses } = donnees;
  // Un vendeur ne paie que depuis sa caisse ; la gestion peut payer hors caisse.
  const avecCaisse = gestion ? depuisCaisse && !!caisse : true;
  const total = depenses.reduce((t, d) => t + d.montant, 0);

  const prendre = async (source: 'galerie' | 'camera') => {
    try {
      setPhoto(await choisirPhoto(source));
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const ajouter = async () => {
    setMessage(null);
    const valeur = entier(montant);
    if (!(valeur > 0))
      return setMessage({ texte: 'Montant : nombre entier attendu.', type: 'erreur' });
    if (!gestion && !caisse) {
      return setMessage({ texte: 'Ouvrez votre caisse pour payer une dépense.', type: 'erreur' });
    }
    setEnvoi(true);
    const id = Crypto.randomUUID();
    try {
      await enregistrer({
        type: 'DEPENSE_ENREGISTRER',
        boutiqueId,
        contenu: {
          id,
          dateDepense: new Date().toISOString(),
          categorie,
          libelle: libelle.trim(),
          montant: valeur,
          moyen,
          caisseId: avecCaisse ? (caisse?.id ?? null) : null,
        },
      });
      setLibelle('');
      setMontant('');
      const image = photo;
      setPhoto(null);
      setMessage({ texte: 'Dépense enregistrée.', type: 'info' });
      if (image) {
        try {
          await envoyerJustificatif(api, id, image);
          setMessage({ texte: 'Dépense et justificatif enregistrés.', type: 'info' });
        } catch {
          setMessage({
            texte: 'Dépense enregistrée ; le justificatif s’enverra en ligne (bouton ci-dessous).',
            type: 'info',
          });
        }
      }
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  const ajouterJustificatif = async (depenseId: string) => {
    setMessage(null);
    try {
      const image = await choisirPhoto('galerie');
      if (!image) return;
      await envoyerJustificatif(api, depenseId, image);
      setMessage({ texte: 'Justificatif enregistré.', type: 'info' });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  const voir = async (depenseId: string) => {
    setMessage(null);
    try {
      setApercu({
        id: depenseId,
        image: await lireImagePrivee(api, `/depenses/${depenseId}/justificatif`),
      });
    } catch (e) {
      setMessage({ texte: messageErreur(e), type: 'erreur' });
    }
  };

  return (
    <Ecran titre="Dépenses" sousTitre={boutique.nom} enHaut>
      <Carte>
        <Texte gras>Nouvelle dépense</Texte>
        <Choix
          libelle="Catégorie"
          options={options(CATEGORIES_DEPENSE, LIBELLES_CATEGORIES_DEPENSE)}
          valeurs={[categorie]}
          surChoix={([c]) => c && setCategorie(c as CategorieDepense)}
        />
        <Champ
          libelle="Libellé"
          value={libelle}
          onChangeText={setLibelle}
          placeholder="Taxi pour la livraison…"
        />
        <Champ
          libelle="Montant"
          value={montant}
          onChangeText={setMontant}
          keyboardType="number-pad"
        />
        <Choix
          libelle="Payée en"
          options={options(MOYENS_REMBOURSEMENT, LIBELLES_MOYENS)}
          valeurs={[moyen]}
          surChoix={([m]) => m && setMoyen(m as MoyenRemboursement)}
        />
        {gestion ? (
          <Choix
            libelle="Origine de l’argent"
            options={[
              { id: 'caisse', nom: caisse ? 'Ma caisse' : 'Ma caisse (fermée)' },
              { id: 'hors', nom: 'Hors caisse' },
            ]}
            valeurs={[avecCaisse ? 'caisse' : 'hors']}
            surChoix={([o]) => setDepuisCaisse(o === 'caisse')}
          />
        ) : (
          <Texte discret>
            {caisse ? 'Payée depuis votre caisse.' : 'Ouvrez votre caisse pour payer une dépense.'}
          </Texte>
        )}
        <Texte discret>
          {photo ? 'Justificatif prêt à envoyer.' : 'Justificatif (photo du reçu) : facultatif.'}
        </Texte>
        <Bouton
          titre="Photographier le reçu"
          variante="secondaire"
          onPress={() => void prendre('camera')}
        />
        <Bouton
          titre="Choisir une photo"
          variante="secondaire"
          onPress={() => void prendre('galerie')}
        />
        <Bouton titre="Enregistrer la dépense" chargement={envoi} onPress={() => void ajouter()} />
      </Carte>
      <Message texte={message?.texte ?? null} type={message?.type} />

      <Texte gras>30 derniers jours : {formaterMontant(total, monnaie)}</Texte>
      {depenses.map((d) => (
        <Carte key={d.id}>
          <Texte gras>
            {LIBELLES_CATEGORIES_DEPENSE[d.categorie]} · {formaterMontant(d.montant, monnaie)}
          </Texte>
          <Texte discret>
            {new Date(d.dateDepense).toLocaleDateString('fr-FR')} · {d.libelle} ·{' '}
            {LIBELLES_MOYENS[d.moyen]}
            {d.caisseId ? ' · caisse' : ' · hors caisse'}
          </Texte>
          {d.justificatif ? (
            <Bouton
              titre="Voir le justificatif"
              variante="secondaire"
              onPress={() => void voir(d.id)}
            />
          ) : d.creeParId === profil.id || gestion ? (
            <Bouton
              titre="Ajouter le justificatif"
              variante="secondaire"
              onPress={() => void ajouterJustificatif(d.id)}
            />
          ) : null}
          {apercu?.id === d.id ? (
            <Image
              source={{ uri: apercu.image }}
              style={{ width: '100%', height: 320 }}
              contentFit="contain"
              accessibilityLabel="Justificatif de la dépense"
            />
          ) : null}
        </Carte>
      ))}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
