import { type LargeurRecu, lignesRecu, recuEscPos } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { ecrireMeta } from '@/lib/base/depot';
import { CLES_IMPRESSION, FUSEAU_PAR_DEFAUT, lireReglagesImpression } from '@/lib/documents';
import {
  bluetoothDisponible,
  chercherImprimantes,
  type ImprimanteBluetooth,
  imprimerBluetooth,
} from '@/lib/imprimante-bluetooth';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

const LARGEURS = [
  { id: '58', nom: '58 mm' },
  { id: '80', nom: '80 mm' },
];

/** Réglages d'impression de cet appareil : largeur du papier, imprimante Bluetooth. */
export default function Imprimante() {
  const { base } = useSync();
  const { profil, boutique } = useSession();
  const enregistres = useLecture((b) => lireReglagesImpression(b), []);
  const [largeur, setLargeur] = useState<LargeurRecu | null>(null);
  const [imprimante, setImprimante] = useState<ImprimanteBluetooth | null | undefined>(undefined);
  const [trouvees, setTrouvees] = useState<ImprimanteBluetooth[]>([]);
  const [recherche, setRecherche] = useState(false);
  const [test, setTest] = useState(false);
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const arreter = useRef<(() => void) | null>(null);

  const largeurActive = largeur ?? enregistres?.largeur ?? 58;
  const imprimanteActive =
    imprimante === undefined ? (enregistres?.imprimante ?? null) : imprimante;

  useEffect(() => () => arreter.current?.(), []);

  const choisirLargeur = async (valeur: string) => {
    if (!base) return;
    const l: LargeurRecu = valeur === '80' ? 80 : 58;
    setLargeur(l);
    await ecrireMeta(base, CLES_IMPRESSION.largeur, String(l));
  };

  const choisirImprimante = async (choisie: ImprimanteBluetooth | null) => {
    if (!base) return;
    arreter.current?.();
    setRecherche(false);
    setImprimante(choisie);
    await ecrireMeta(base, CLES_IMPRESSION.imprimante, choisie ? JSON.stringify(choisie) : null);
    setMessage(choisie ? { texte: `${choisie.nom} retenue.`, type: 'info' } : null);
  };

  const chercher = async () => {
    setMessage(null);
    setTrouvees([]);
    try {
      arreter.current = await chercherImprimantes(
        (i) => setTrouvees((liste) => [...liste, i]),
        (texte) => setMessage({ texte, type: 'erreur' }),
      );
      setRecherche(true);
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    }
  };

  const imprimerTest = async () => {
    if (!imprimanteActive || !profil) return;
    setMessage(null);
    setTest(true);
    try {
      const essai = lignesRecu(
        {
          commerce: profil.commerce.nom,
          boutique: {
            nom: boutique?.nom ?? '',
            adresse: boutique?.adresse ?? null,
            telephone: boutique?.telephone ?? null,
          },
          numero: 'ESSAI',
          dateVente: new Date().toISOString(),
          statut: 'VALIDEE',
          client: null,
          lignes: [
            {
              designation: 'Essai d’impression : é è à ç ô ù',
              imei: null,
              quantite: 1,
              tarif: 'DETAIL',
              prixUnitaire: 0,
              total: 0,
              garantieMois: 0,
              finGarantie: null,
            },
          ],
          sousTotal: 0,
          remise: 0,
          total: 0,
          montantPaye: 0,
          renduMonnaie: 0,
          paiements: [],
          monnaie: profil.commerce.monnaie,
          fuseau: profil.commerce.fuseau ?? FUSEAU_PAR_DEFAUT,
        },
        largeurActive,
      );
      await imprimerBluetooth(imprimanteActive.id, recuEscPos(essai));
      setMessage({ texte: 'Page d’essai envoyée.', type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setTest(false);
    }
  };

  return (
    <Ecran titre="Imprimante" sousTitre="Réglages de cet appareil" enHaut>
      <Choix
        libelle="Largeur du papier des reçus"
        options={LARGEURS}
        valeurs={[String(largeurActive)]}
        surChoix={([v]) => v && void choisirLargeur(v)}
      />
      {bluetoothDisponible ? (
        <Carte>
          <Texte gras>Imprimante thermique Bluetooth</Texte>
          <Texte discret>
            {imprimanteActive ? `Retenue : ${imprimanteActive.nom}` : 'Aucune imprimante retenue.'}
          </Texte>
          {imprimanteActive ? (
            <>
              <Bouton
                titre="Imprimer une page d’essai"
                chargement={test}
                onPress={() => void imprimerTest()}
              />
              <Bouton
                titre="Oublier cette imprimante"
                variante="secondaire"
                onPress={() => void choisirImprimante(null)}
              />
            </>
          ) : null}
          <Bouton
            titre={recherche ? 'Recherche en cours…' : 'Chercher les imprimantes'}
            variante="secondaire"
            desactive={recherche}
            onPress={() => void chercher()}
          />
          {trouvees.map((i) => (
            <Bouton
              key={i.id}
              titre={i.nom}
              variante="secondaire"
              onPress={() => void choisirImprimante(i)}
            />
          ))}
          {recherche && !trouvees.length ? (
            <Texte discret>Allumez l’imprimante et rapprochez-la du téléphone.</Texte>
          ) : null}
        </Carte>
      ) : (
        <Carte>
          <Texte discret>
            Sur ordinateur, les reçus et factures s’impriment par l’imprimante du système (réglez le
            format du papier dans la fenêtre d’impression). L’imprimante Bluetooth se règle depuis
            l’application Android.
          </Texte>
        </Carte>
      )}
      <Message texte={message?.texte ?? null} type={message?.type} />
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}
