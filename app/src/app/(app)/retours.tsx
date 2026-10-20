import {
  formaterMontant,
  LIBELLES_TYPES_RETOUR,
  normaliserRecherche,
  type RetourSync,
} from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Champ, Ecran, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

interface VenteTrouvee {
  id: string;
  numero: string;
  dateVente: string;
  total: number;
  client: string | null;
}

/**
 * Retours et échanges : retrouver la vente par son numéro de facture, l'IMEI d'un
 * téléphone vendu ou le client (ventes de cette boutique gardées sur l'appareil).
 */
export default function Retours() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const monnaie = profil?.commerce.monnaie;
  const boutiqueId = boutique?.id ?? '';
  const [recherche, setRecherche] = useState('');
  const [scanner, setScanner] = useState(false);

  const ventes = useLecture(
    async (b) => {
      const texte = recherche.trim();
      if (texte.length < 2) return [];
      const chiffres = texte.replace(/\D/g, '');
      return b.tous<VenteTrouvee>(
        `SELECT DISTINCT v.id, v.numero, v.dateVente, v.total, c.nom AS client
           FROM vente v
           LEFT JOIN client c ON c.id = v.clientId
           LEFT JOIN ligneVente l ON l.venteId = v.id
           LEFT JOIN article a ON a.id = l.articleId
          WHERE v.boutiqueId = ? AND v.statut = 'VALIDEE'
            AND (v.numero LIKE ? OR c.recherche LIKE ? OR (? <> '' AND (a.imei LIKE ? OR c.telephone LIKE ?)))
          ORDER BY v.dateVente DESC LIMIT 20`,
        [
          boutiqueId,
          `%${texte.toUpperCase()}%`,
          `%${normaliserRecherche(texte)}%`,
          chiffres,
          `%${chiffres}%`,
          `%${chiffres}%`,
        ],
      );
    },
    [recherche, boutiqueId],
  );
  const recents = useLecture(
    (b) =>
      b.tous<RetourSync & { numero: string }>(
        `SELECT r.*, v.numero FROM retour r JOIN vente v ON v.id = r.venteId
          WHERE r.boutiqueId = ? ORDER BY r.dateRetour DESC LIMIT 20`,
        [boutiqueId],
      ),
    [boutiqueId],
  );

  const ligne = (cle: string, titre: string, detail: string, droite: string, id: string) => (
    <Pressable
      key={cle}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/vente/[id]', params: { id } })}
      style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{titre}</Text>
        <Text style={{ color: colors.text, opacity: 0.65 }}>{detail}</Text>
      </View>
      <Text style={{ color: colors.text, fontWeight: '700' }}>{droite}</Text>
    </Pressable>
  );

  return (
    <Ecran titre="Retours et échanges" sousTitre={boutique?.nom} enHaut>
      <Champ
        libelle="Vente : n° de facture, IMEI, nom ou téléphone du client"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
        placeholder="MAD-…, 35…, Diallo…"
      />
      {scannerDisponible ? (
        <Bouton titre="Scanner l’IMEI" variante="secondaire" onPress={() => setScanner(true)} />
      ) : null}
      {recherche.trim().length >= 2 && ventes?.length === 0 ? (
        <Texte discret>
          Aucune vente trouvée sur cet appareil (ventes des 60 derniers jours de la boutique).
        </Texte>
      ) : null}
      {ventes?.map((v) =>
        ligne(
          v.id,
          v.numero,
          `${new Date(v.dateVente).toLocaleDateString('fr-FR')} · ${v.client ?? 'client de passage'}`,
          formaterMontant(v.total, monnaie),
          v.id,
        ),
      )}
      {recents?.length ? <Texte gras>Derniers retours</Texte> : null}
      {recents?.map((r) =>
        ligne(
          r.id,
          `${LIBELLES_TYPES_RETOUR[r.type]} · facture ${r.numero}`,
          `${new Date(r.dateRetour).toLocaleDateString('fr-FR')} · ${r.motif}`,
          formaterMontant(r.valeur, monnaie),
          r.venteId,
        ),
      )}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      <Scanner visible={scanner} surCode={setRecherche} fermer={() => setScanner(false)} />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
});
