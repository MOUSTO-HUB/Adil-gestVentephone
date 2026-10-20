import { formaterMontant, type FournisseurSync } from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

interface Achats {
  dette: number;
  achats: {
    id: string;
    numero: string;
    date: string;
    statut: string;
    montantTotal: number;
    montantPaye: number;
    reste: number;
    boutique: string;
  }[];
}

const STATUTS: Record<string, string> = {
  BROUILLON: 'brouillon',
  PARTIEL: 'reçu en partie',
  RECU: 'reçu',
  ANNULE: 'annulé',
};

/** Fiche fournisseur : coordonnées, dette et bons d'achat (en ligne). */
export default function FicheFournisseur() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profil, api } = useSession();
  const monnaie = profil?.commerce.monnaie;
  const fournisseur = useLecture(
    (b) => b.premier<FournisseurSync>('SELECT * FROM fournisseur WHERE id = ?', [id]),
    [id],
  );
  const [achats, setAchats] = useState<Achats | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    api
      .requete<Achats>(`/fournisseurs/${id}/achats`)
      .then((a) => actif && setAchats(a))
      .catch((e: unknown) => actif && setErreur(messageErreur(e)));
    return () => {
      actif = false;
    };
  }, [api, id]);

  if (fournisseur === undefined)
    return (
      <Ecran titre="Fournisseur" enHaut>
        {null}
      </Ecran>
    );
  if (!fournisseur) {
    return (
      <Ecran titre="Fournisseur" enHaut>
        <Message texte="Fournisseur introuvable." />
      </Ecran>
    );
  }
  const dette = achats?.dette ?? fournisseur.dette;

  return (
    <Ecran titre={fournisseur.nom} enHaut>
      <Carte>
        {fournisseur.telephone ? <Texte gras>{fournisseur.telephone}</Texte> : null}
        {fournisseur.adresse ? <Texte discret>{fournisseur.adresse}</Texte> : null}
        {fournisseur.note ? <Texte discret>{fournisseur.note}</Texte> : null}
        <Texte gras>Reste dû : {formaterMontant(dette, monnaie)}</Texte>
      </Carte>
      <Bouton
        titre="Modifier la fiche"
        onPress={() =>
          router.push({ pathname: '/fournisseur/edition', params: { id: fournisseur.id } })
        }
      />
      <Texte gras>Bons d’achat</Texte>
      {erreur ? <Texte discret>Disponible en ligne : {erreur}</Texte> : null}
      {achats?.achats.length === 0 ? <Texte discret>Aucun bon d’achat.</Texte> : null}
      {achats?.achats.map((a) => (
        <Carte key={a.id}>
          <Texte gras>
            {a.numero} · {new Date(a.date).toLocaleDateString('fr-FR')}
          </Texte>
          <Texte discret>
            {a.boutique} · {STATUTS[a.statut] ?? a.statut}
          </Texte>
          <Texte>
            Total {formaterMontant(a.montantTotal, monnaie)} · payé{' '}
            {formaterMontant(a.montantPaye, monnaie)}
            {a.reste > 0 ? ` · reste ${formaterMontant(a.reste, monnaie)}` : ''}
          </Texte>
        </Carte>
      ))}
    </Ecran>
  );
}
