import { etatGarantie, formaterDate, imeiValide, normaliserImei } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { ErreurApi, ErreurReseau, messageErreur } from '@/lib/api';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

interface Garantie {
  imei: string;
  produit: string;
  garantieMois: number;
  venteId: string;
  numero: string;
  dateVente: string;
  boutique: string | null;
  client: { nom: string; telephone: string } | null;
  finGarantie: string | null;
}

/** Garantie d'un téléphone vendu, par son IMEI (serveur ; base de l'appareil hors ligne). */
export default function ConsultationGarantie() {
  const { profil, api } = useSession();
  const fuseau = profil?.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const [saisie, setSaisie] = useState('');
  const [imei, setImei] = useState('');
  const [serveur, setServeur] = useState<Garantie | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [scanner, setScanner] = useState(false);

  const local = useLecture(
    async (b) => {
      if (!imei) return null;
      const l = await b.premier<
        Omit<Garantie, 'client' | 'boutique'> & {
          clientNom: string | null;
          clientTelephone: string | null;
        }
      >(
        `SELECT a.imei, p.nom AS produit, p.garantieMois, v.id AS venteId, v.numero, v.dateVente,
                c.nom AS clientNom, c.telephone AS clientTelephone, l.finGarantie
           FROM ligneVente l
           JOIN article a ON a.id = l.articleId
           JOIN produit p ON p.id = l.produitId
           JOIN vente v ON v.id = l.venteId
           LEFT JOIN client c ON c.id = v.clientId
          WHERE (a.imei = ? OR a.imei2 = ?) AND v.statut = 'VALIDEE'
          ORDER BY v.dateVente DESC LIMIT 1`,
        [imei, imei],
      );
      if (!l) return null;
      const { clientNom, clientTelephone, ...reste } = l;
      return {
        ...reste,
        boutique: null,
        client: clientNom ? { nom: clientNom, telephone: clientTelephone ?? '' } : null,
      } satisfies Garantie;
    },
    [imei],
  );

  useEffect(() => {
    if (!imei) return;
    let actif = true;
    api
      .requete<Garantie>(`/ventes/garantie/${imei}`)
      .then((g) => {
        if (!actif) return;
        setServeur(g);
        setHorsLigne(false);
        setErreur(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setServeur(null);
        setHorsLigne(e instanceof ErreurReseau);
        setErreur(
          e instanceof ErreurReseau
            ? null
            : e instanceof ErreurApi && e.statut === 404
              ? 'Aucune vente de ce téléphone.'
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
    setServeur(null);
    setErreur(null);
    setImei(normalise);
  };

  const g = serveur ?? (horsLigne ? local : null);
  const etat = g ? etatGarantie(g.finGarantie, new Date()) : null;

  return (
    <Ecran titre="Garantie" sousTitre="Retrouver la garantie par l’IMEI" enHaut>
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
      <Message texte={erreur} />
      {horsLigne && !local ? (
        <Message texte="Hors ligne : aucune vente de cet IMEI dans les données de cet appareil (60 derniers jours)." />
      ) : null}

      {g && etat ? (
        <Carte>
          <Texte gras>{g.produit}</Texte>
          <Texte discret>IMEI {g.imei}</Texte>
          <Texte>
            Vendu le {formaterDate(g.dateVente, fuseau)} · facture {g.numero}
            {g.boutique ? ` · ${g.boutique}` : ''}
          </Texte>
          <Texte>
            Client : {g.client ? `${g.client.nom} (${g.client.telephone})` : 'client de passage'}
          </Texte>
          <Texte gras>
            {etat.etat === 'SANS'
              ? 'Produit vendu sans garantie.'
              : etat.etat === 'EXPIREE'
                ? `Garantie expirée le ${formaterDate(etat.fin, fuseau)}.`
                : `Sous garantie : ${etat.joursRestants} jour(s) restant(s), jusqu’au ${formaterDate(etat.fin, fuseau)}.`}
          </Texte>
          {g.garantieMois > 0 ? (
            <Texte discret>Durée de garantie du produit : {g.garantieMois} mois.</Texte>
          ) : null}
          {horsLigne ? <Texte discret>Données de cet appareil (hors ligne).</Texte> : null}
          {local?.venteId === g.venteId ? (
            <Bouton
              titre="Voir la vente"
              variante="secondaire"
              onPress={() => router.push({ pathname: '/vente/[id]', params: { id: g.venteId } })}
            />
          ) : null}
        </Carte>
      ) : null}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      <Scanner visible={scanner} surCode={chercher} fermer={() => setScanner(false)} />
    </Ecran>
  );
}
