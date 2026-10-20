import { formaterMontant, type VenteSync } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Carte, Ecran, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';

const PERIODES = [
  { id: '0', nom: 'Aujourd’hui' },
  { id: '7', nom: '7 jours' },
  { id: '30', nom: '30 jours' },
];

/** Ventes de la boutique (base locale) : total de la période, détail de chaque vente. */
export default function Ventes() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const [periode, setPeriode] = useState('0');
  const monnaie = profil?.commerce.monnaie;

  const ventes = useLecture(
    async (b) => {
      const debut = new Date();
      debut.setHours(0, 0, 0, 0);
      debut.setDate(debut.getDate() - Number(periode));
      return b.tous<VenteSync & { client: string | null }>(
        `SELECT v.*, c.nom AS client FROM vente v LEFT JOIN client c ON c.id = v.clientId
          WHERE v.boutiqueId = ? AND v.dateVente >= ? ORDER BY v.dateVente DESC LIMIT 300`,
        [boutique?.id ?? '', debut.toISOString()],
      );
    },
    [boutique?.id, periode],
  );
  const valides = ventes?.filter((v) => v.statut === 'VALIDEE') ?? [];
  const total = valides.reduce((t, v) => t + v.total, 0);

  return (
    <Ecran titre="Ventes" sousTitre={boutique?.nom} enHaut>
      <Choix
        libelle="Période"
        options={PERIODES}
        valeurs={[periode]}
        surChoix={([p]) => p && setPeriode(p)}
      />
      <Carte>
        <Texte gras>
          {valides.length} vente(s) · {formaterMontant(total, monnaie)}
        </Texte>
      </Carte>
      {ventes?.map((v) => (
        <Pressable
          key={v.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/vente/[id]', params: { id: v.id } })}
          style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {v.numero}
              {v.client ? ` · ${v.client}` : ''}
            </Text>
            <Text style={{ color: colors.text, opacity: 0.65 }}>
              {new Date(v.dateVente).toLocaleString('fr-FR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </Text>
          </View>
          <Text
            style={{
              color: v.statut === 'ANNULEE' ? colors.notification : colors.text,
              fontWeight: '700',
              textDecorationLine: v.statut === 'ANNULEE' ? 'line-through' : 'none',
            }}
          >
            {formaterMontant(v.total, monnaie)}
          </Text>
        </Pressable>
      ))}
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
