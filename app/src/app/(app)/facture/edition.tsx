import {
  factureHtml,
  normaliserTelephone,
  schemaFactureVente,
  type VenteSync,
} from '@gestvente/commun';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { chargerDocument } from '@/lib/documents';
import { imprimerHtml } from '@/lib/impression';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

type VenteFacture = VenteSync & {
  client: string | null;
  clientTelephone: string | null;
  clientAdresse: string | null;
};

/**
 * Facture d'une vente : nom, contact et adresse du client, tous obligatoires.
 * Préremplis depuis la vente ou la fiche du client ; la facture s'imprime ensuite.
 */
export default function EditionFacture() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const vente = useLecture(
    (b) =>
      b.premier<VenteFacture>(
        `SELECT v.*, c.nom AS client, c.telephone AS clientTelephone, c.adresse AS clientAdresse
           FROM vente v LEFT JOIN client c ON c.id = v.clientId WHERE v.id = ?`,
        [id],
      ),
    [id],
  );
  if (vente === undefined) {
    return (
      <Ecran titre="Facture" enHaut>
        {null}
      </Ecran>
    );
  }
  if (!vente) {
    return (
      <Ecran titre="Facture" enHaut>
        <Message texte="Vente introuvable." />
      </Ecran>
    );
  }
  return <Formulaire vente={vente} />;
}

function Formulaire({ vente }: { vente: VenteFacture }) {
  const { profil, boutique } = useSession();
  const { enregistrer, base } = useSync();
  const [nom, setNom] = useState(vente.nomClient ?? vente.client ?? '');
  const [contact, setContact] = useState(vente.contactClient ?? vente.clientTelephone ?? '');
  const [adresse, setAdresse] = useState(vente.adresseClient ?? vente.clientAdresse ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const interdit = profil?.role === 'VENDEUR' && vente.vendeurId !== profil.id;

  const valider = async () => {
    setErreur(null);
    if (!boutique) return;
    const telephone = contact.trim()
      ? (normaliserTelephone(contact, profil?.commerce.indicatif) ?? contact.trim())
      : '';
    const saisie = schemaFactureVente.safeParse({
      venteId: vente.id,
      nomClient: nom,
      contactClient: telephone,
      adresseClient: adresse,
    });
    if (!saisie.success) {
      setErreur(saisie.error.issues.map((i) => i.message).join('\n'));
      return;
    }
    setEnvoi(true);
    try {
      await enregistrer({ type: 'VENTE_FACTURE', boutiqueId: boutique.id, contenu: saisie.data });
      router.replace({ pathname: '/vente/[id]', params: { id: vente.id } });
      // Facture A4 aussitôt (sur ordinateur, « Enregistrer en PDF » dans la fenêtre d'impression).
      const document =
        base && profil
          ? await chargerDocument(base, vente.id, {
              commerce: profil.commerce.nom,
              boutique,
              monnaie: profil.commerce.monnaie,
              fuseau: profil.commerce.fuseau,
            })
          : null;
      if (document) await imprimerHtml(factureHtml(document)).catch(() => undefined);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Ecran
      titre={vente.factureEmise ? `Modifier la facture ${vente.numero}` : 'Faire la facture'}
      sousTitre={`Vente ${vente.numero}`}
      enHaut
    >
      <Carte titre="Client de la facture" icone="person">
        <Texte discret>Les trois informations sont obligatoires pour la facture.</Texte>
        <Champ
          libelle="Nom du client"
          value={nom}
          onChangeText={setNom}
          placeholder="Ex. Mamadou Diallo"
          autoCapitalize="words"
        />
        <Champ
          libelle="Contact (téléphone)"
          value={contact}
          onChangeText={setContact}
          keyboardType="phone-pad"
          placeholder="620 11 22 33"
        />
        <Champ
          libelle="Adresse"
          value={adresse}
          onChangeText={setAdresse}
          placeholder="Quartier, ville"
        />
      </Carte>
      {interdit ? (
        <Message texte="Un vendeur ne modifie que les factures de ses propres ventes." />
      ) : null}
      <Message texte={erreur} />
      <Bouton
        titre="Enregistrer et imprimer la facture"
        icone="print"
        chargement={envoi}
        onPress={() => void valider()}
      />
    </Ecran>
  );
}
