import { factureHtml, formaterMontant, type VenteSync } from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BoutonLigne } from '@/components/bouton-ligne';
import { Champ, Ecran, Message, Texte } from '@/components/ui';
import { chargerDocument } from '@/lib/documents';
import { imprimerHtml } from '@/lib/impression';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

type Facture = VenteSync & { client: string | null };

/**
 * Factures émises dans la boutique (base locale, hors ligne) : recherche par numéro,
 * nom ou contact du client ; chaque facture se modifie ou s'imprime depuis la liste.
 */
export default function Factures() {
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const { base } = useSync();
  const [recherche, setRecherche] = useState('');
  const [impression, setImpression] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const monnaie = profil?.commerce.monnaie;

  const factures = useLecture(
    (b) =>
      b.tous<Facture>(
        `SELECT v.*, c.nom AS client FROM vente v LEFT JOIN client c ON c.id = v.clientId
          WHERE v.boutiqueId = ? AND v.factureEmise = 1 ORDER BY v.dateVente DESC LIMIT 300`,
        [boutique?.id ?? ''],
      ),
    [boutique?.id],
  );

  const mot = recherche.trim().toLowerCase();
  const visibles = (factures ?? []).filter(
    (f) =>
      !mot ||
      f.numero.toLowerCase().includes(mot) ||
      (f.nomClient ?? f.client ?? '').toLowerCase().includes(mot) ||
      (f.contactClient ?? '').toLowerCase().includes(mot),
  );

  const imprimer = async (venteId: string) => {
    setErreur(null);
    setImpression(venteId);
    try {
      const document =
        base && profil && boutique
          ? await chargerDocument(base, venteId, {
              commerce: profil.commerce.nom,
              boutique,
              monnaie: profil.commerce.monnaie,
              fuseau: profil.commerce.fuseau,
            })
          : null;
      if (!document) throw new Error('Facture introuvable sur cet appareil.');
      await imprimerHtml(factureHtml(document));
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setImpression(null);
    }
  };

  return (
    <Ecran titre="Factures" sousTitre={boutique?.nom} enHaut>
      <Texte discret>
        Une facture se fait à la fin d’une vente (« Oui, faire la facture ») ou depuis le détail
        d’une vente.
      </Texte>
      <Champ
        libelle="Rechercher (numéro, nom ou contact du client)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
      />
      <Message texte={erreur} />
      {factures && visibles.length === 0 ? <Texte discret>Aucune facture.</Texte> : null}
      {visibles.map((f) => (
        <View
          key={f.id}
          style={[styles.ligne, { borderColor: c.bordure, backgroundColor: c.carte }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ouvrir la facture ${f.numero}`}
            onPress={() => router.push({ pathname: '/vente/[id]', params: { id: f.id } })}
            style={styles.texte}
          >
            <Text style={[styles.nom, { color: c.texte }]}>
              {f.numero} · {f.nomClient ?? f.client ?? 'Client'}
            </Text>
            <Text style={{ color: c.texteDiscret }}>
              {new Date(f.dateVente).toLocaleDateString('fr-FR')} ·{' '}
              {formaterMontant(f.total, monnaie)}
              {f.contactClient ? ` · ${f.contactClient}` : ''}
            </Text>
            {f.adresseClient ? (
              <Text style={{ color: c.texteDiscret }}>{f.adresseClient}</Text>
            ) : null}
            {f.statut === 'ANNULEE' ? (
              <Text style={[styles.statut, { color: c.danger }]}>Vente annulée</Text>
            ) : null}
          </Pressable>
          <View style={styles.actions}>
            <BoutonLigne
              titre="Modifier"
              icone="create"
              libelleAccessible={`Modifier la facture ${f.numero}`}
              surAppui={() => router.push({ pathname: '/facture/edition', params: { id: f.id } })}
            />
            <BoutonLigne
              titre="Imprimer"
              icone="print"
              libelleAccessible={`Imprimer la facture ${f.numero}`}
              chargement={impression === f.id}
              surAppui={() => void imprimer(f.id)}
            />
          </View>
        </View>
      ))}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  texte: { flex: 1, gap: 2 },
  nom: { fontSize: 16, fontWeight: '700' },
  statut: { fontSize: 14, fontWeight: '700' },
  actions: { gap: 6 },
});
