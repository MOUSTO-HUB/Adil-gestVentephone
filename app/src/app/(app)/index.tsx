import { LIBELLES_ROLES, peutGererSessions } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { produitsSousSeuil } from '@/lib/achats';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

/** Accueil : alertes de stock et accès aux écrans (la vente en premier). */
export default function Accueil() {
  const { profil, boutique, choisirBoutique, verrouiller, deconnexion, rafraichirProfil } =
    useSession();
  const { etat } = useSync();

  useEffect(() => {
    rafraichirProfil().catch(() => undefined);
  }, [rafraichirProfil]);

  const resume = useLecture(
    async (base) =>
      base.premier<{ produits: number; telephones: number }>(
        `SELECT (SELECT COUNT(*) FROM produit WHERE archive = 0) AS produits,
                (SELECT COUNT(*) FROM article WHERE boutiqueId = ? AND statut = 'EN_STOCK') AS telephones`,
        [boutique?.id ?? ''],
      ),
    [boutique?.id],
  );

  const sousSeuil = useLecture(
    (base) => produitsSousSeuil(base, boutique?.id ?? ''),
    [boutique?.id],
  );

  if (!profil || !boutique) return null;

  const seDeconnecter = async () => {
    if (
      etat.enAttente > 0 &&
      !(await confirmer(
        `${etat.enAttente} opération(s) ne sont pas encore envoyées au serveur et seront perdues. Se déconnecter quand même ?`,
        'Se déconnecter',
      ))
    ) {
      return;
    }
    await deconnexion();
  };

  return (
    <Ecran titre={boutique.nom} sousTitre={profil.commerce.nom} enHaut>
      <Carte>
        <Texte gras>{profil.nom}</Texte>
        <Texte discret>{LIBELLES_ROLES[profil.role]}</Texte>
        {resume ? (
          <Texte discret>
            Catalogue : {resume.produits} produits · {resume.telephones} téléphones en stock
          </Texte>
        ) : null}
      </Carte>
      {sousSeuil?.length ? (
        <Message
          texte={`Stock bas (${sousSeuil.length}) : ${sousSeuil
            .slice(0, 5)
            .map((p) => `${p.nom} (${p.quantite})`)
            .join(', ')}${sousSeuil.length > 5 ? '…' : ''}`}
        />
      ) : null}
      <Bouton titre="Vendre" onPress={() => router.push('/vente')} />
      <Bouton titre="Ventes" variante="secondaire" onPress={() => router.push('/ventes')} />
      <Bouton titre="Stock" onPress={() => router.push('/stock')} />
      <Bouton titre="Fiche IMEI" variante="secondaire" onPress={() => router.push('/imei')} />
      <Bouton titre="Garantie" variante="secondaire" onPress={() => router.push('/garantie')} />
      <Bouton titre="Clients" onPress={() => router.push('/clients')} />
      {peutGererSessions(profil.role) ? (
        <>
          <Bouton titre="Achats" onPress={() => router.push('/achats')} />
          <Bouton
            titre="Inventaire"
            variante="secondaire"
            onPress={() => router.push('/inventaire')}
          />
          <Bouton titre="Fournisseurs" onPress={() => router.push('/fournisseurs')} />
        </>
      ) : null}
      {profil.boutiques.length > 1 ? (
        <Bouton
          titre="Changer de boutique"
          variante="secondaire"
          onPress={() => void choisirBoutique(null)}
        />
      ) : null}
      {peutGererSessions(profil.role) ? (
        <Bouton
          titre="Appareils connectés"
          variante="secondaire"
          onPress={() => router.push('/appareils')}
        />
      ) : null}
      <Bouton titre="Imprimante" variante="secondaire" onPress={() => router.push('/imprimante')} />
      <Bouton titre="Verrouiller" variante="secondaire" onPress={verrouiller} />
      <Bouton titre="Se déconnecter" variante="danger" onPress={() => void seDeconnecter()} />
    </Ecran>
  );
}
