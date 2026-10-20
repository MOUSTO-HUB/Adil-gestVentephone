import { formaterMontant, imeiValide, normaliserImei } from '@gestvente/commun';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { ErreurApi, ErreurReseau, messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

interface Fiche {
  imei: string;
  imei2: string | null;
  produit: string;
  boutique: string;
  statut: string;
  origine: string;
  prixAchat: number | null;
  finGarantie: string | null;
  client: string | null;
  evenements: {
    date: string;
    type: string;
    boutique: string;
    detail: string;
    utilisateur: string | null;
  }[];
}

const STATUTS: Record<string, string> = {
  EN_STOCK: 'En stock',
  A_REPARER: 'À réparer',
  VENDU: 'Vendu',
  EN_TRANSFERT: 'En transfert',
  REBUT: 'Sorti du stock',
};

const TYPES: Record<string, string> = {
  ACHAT: 'Achat',
  VENTE: 'Vente',
  ANNULATION_VENTE: 'Vente annulée',
  RETOUR: 'Retour',
  TROC_ENTREE: 'Repris en troc',
  TRANSFERT_SORTIE: 'Transfert (départ)',
  TRANSFERT_ENTREE: 'Transfert (arrivée)',
  AJUSTEMENT: 'Ajustement',
  REBUT: 'Sortie du stock',
};

/** Fiche d'un téléphone par son IMEI : état local (hors ligne) et historique complet (en ligne). */
export default function FicheImei() {
  const params = useLocalSearchParams<{ imei?: string }>();
  const { profil, api } = useSession();
  const [saisie, setSaisie] = useState(params.imei ?? '');
  const [imei, setImei] = useState(params.imei ? normaliserImei(params.imei) : '');
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [scanner, setScanner] = useState(false);
  const monnaie = profil?.commerce.monnaie;

  const local = useLecture(
    async (b) =>
      imei
        ? b.premier<{ statut: string; produit: string; boutiqueId: string }>(
            'SELECT a.statut, p.nom AS produit, a.boutiqueId FROM article a JOIN produit p ON p.id = a.produitId WHERE a.imei = ? OR a.imei2 = ?',
            [imei, imei],
          )
        : null,
    [imei],
  );

  useEffect(() => {
    if (!imei) return;
    let actif = true;
    api
      .requete<Fiche>(`/articles/imei/${imei}`)
      .then((f) => {
        if (!actif) return;
        setFiche(f);
        setErreur(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setFiche(null);
        setErreur(
          e instanceof ErreurReseau
            ? 'Historique complet disponible en ligne.'
            : e instanceof ErreurApi && e.statut === 404
              ? 'Aucun téléphone avec cet IMEI dans le commerce.'
              : messageErreur(e),
        );
      });
    return () => {
      actif = false;
    };
  }, [api, imei]);

  const chercher = (valeur: string) => {
    const normalise = normaliserImei(valeur);
    setSaisie(normalise);
    if (!imeiValide(normalise)) {
      setErreur('IMEI invalide : 15 chiffres avec clé de contrôle.');
      return;
    }
    setFiche(null);
    setErreur(null);
    setImei(normalise);
  };

  return (
    <Ecran titre="Fiche IMEI" enHaut>
      <Champ
        libelle="IMEI"
        value={saisie}
        onChangeText={setSaisie}
        keyboardType="number-pad"
        returnKeyType="search"
        onSubmitEditing={() => chercher(saisie)}
        placeholder="Scannez ou tapez l’IMEI puis Entrée"
      />
      <Bouton titre="Rechercher" onPress={() => chercher(saisie)} />
      {scannerDisponible ? (
        <Bouton titre="Scanner l’IMEI" variante="secondaire" onPress={() => setScanner(true)} />
      ) : null}
      <Message texte={erreur} type={fiche || local ? 'info' : 'erreur'} />

      {local && !fiche ? (
        <Carte>
          <Texte gras>{local.produit}</Texte>
          <Texte discret>{STATUTS[local.statut] ?? local.statut} (données de cet appareil)</Texte>
        </Carte>
      ) : null}
      {fiche ? (
        <>
          <Carte>
            <Texte gras>{fiche.produit}</Texte>
            <Texte>
              {STATUTS[fiche.statut] ?? fiche.statut} · {fiche.boutique}
            </Texte>
            {fiche.client ? <Texte discret>Client : {fiche.client}</Texte> : null}
            {fiche.finGarantie ? (
              <Texte discret>
                Garantie jusqu’au {new Date(fiche.finGarantie).toLocaleDateString('fr-FR')}
                {new Date(fiche.finGarantie) < new Date() ? ' (expirée)' : ''}
              </Texte>
            ) : null}
            {fiche.prixAchat !== null ? (
              <Texte discret>Prix d’achat : {formaterMontant(fiche.prixAchat, monnaie)}</Texte>
            ) : null}
            {fiche.origine === 'TROC' ? <Texte discret>Repris lors d’un troc</Texte> : null}
          </Carte>
          <Texte gras>Historique</Texte>
          {fiche.evenements.map((e, i) => (
            <Carte key={`${e.date}-${i}`}>
              <Texte gras>
                {new Date(e.date).toLocaleDateString('fr-FR')} · {TYPES[e.type] ?? e.type}
              </Texte>
              <Texte discret>
                {e.boutique}
                {e.detail ? ` · ${e.detail}` : ''}
                {e.utilisateur ? ` · par ${e.utilisateur}` : ''}
              </Texte>
            </Carte>
          ))}
        </>
      ) : null}
      <Scanner visible={scanner} surCode={chercher} fermer={() => setScanner(false)} />
    </Ecran>
  );
}
