import { formaterMontant, normaliserImei } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, Champ, Ecran, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

interface LigneStock {
  id: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  prixDetail: number;
  quantite: number | null;
  seuilMinimum: number | null;
}

/**
 * Stock de la boutique, lu dans la base locale (fonctionne hors ligne).
 * Recherche par nom, code-barres ou IMEI.
 */
export default function Stock() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const [recherche, setRecherche] = useState('');
  const terme = recherche.trim();
  const imei = normaliserImei(terme);

  const lignes = useLecture(
    (base) =>
      base.tous<LigneStock>(
        `SELECT p.id, p.nom, p.type, COALESCE(pb.prixDetail, p.prixDetail) AS prixDetail,
                s.quantite, s.seuilMinimum
           FROM produit p
           LEFT JOIN stock s ON s.produitId = p.id AND s.boutiqueId = ?
           LEFT JOIN prixBoutique pb ON pb.produitId = p.id AND pb.boutiqueId = ?
          WHERE p.archive = 0
            AND (? = '' OR p.nom LIKE ? OR p.codeBarres = ?
                 OR p.id IN (SELECT produitId FROM article WHERE imei = ? AND boutiqueId = ?))
          ORDER BY p.nom
          LIMIT 200`,
        [
          boutique?.id ?? '',
          boutique?.id ?? '',
          terme,
          `%${terme}%`,
          terme,
          imei,
          boutique?.id ?? '',
        ],
      ),
    [boutique?.id, terme, imei],
  );

  return (
    <Ecran titre="Stock" sousTitre={boutique?.nom} enHaut>
      <Champ
        libelle="Rechercher (nom, code-barres ou IMEI)"
        value={recherche}
        onChangeText={setRecherche}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {lignes?.length === 0 ? <Texte discret>Aucun produit trouvé.</Texte> : null}
      {lignes?.map((l) => {
        const quantite = l.quantite ?? 0;
        const alerte = l.seuilMinimum !== null && l.seuilMinimum > 0 && quantite <= l.seuilMinimum;
        return (
          <Pressable
            key={l.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/produit/[id]', params: { id: l.id } })}
            style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <View style={styles.texte}>
              <Text style={[styles.nom, { color: colors.text }]}>{l.nom}</Text>
              <Text style={{ color: colors.text, opacity: 0.65 }}>
                {formaterMontant(l.prixDetail, profil?.commerce.monnaie)}
              </Text>
            </View>
            <Text
              style={[styles.quantite, { color: alerte ? colors.notification : colors.text }]}
              accessibilityLabel={`${quantite} en stock${alerte ? ', stock bas' : ''}`}
            >
              {quantite}
            </Text>
          </Pressable>
        );
      })}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
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
  texte: { flex: 1, gap: 2 },
  nom: { fontSize: 16, fontWeight: '600' },
  quantite: { fontSize: 20, fontWeight: '700', minWidth: 36, textAlign: 'right' },
});
