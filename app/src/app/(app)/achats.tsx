import Ionicons from '@expo/vector-icons/Ionicons';
import { formaterMontant } from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bouton, Champ, Ecran, Texte } from '@/components/ui';
import { achatsDeLaBoutique, LIBELLES_STATUTS_ACHAT } from '@/lib/achats';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

type Filtre = 'A_RECEVOIR' | 'RECUS' | 'ANNULES' | 'TOUS';

const FILTRES: { valeur: Filtre; libelle: string }[] = [
  { valeur: 'A_RECEVOIR', libelle: 'À recevoir' },
  { valeur: 'RECUS', libelle: 'Reçus' },
  { valeur: 'ANNULES', libelle: 'Annulés' },
  { valeur: 'TOUS', libelle: 'Tous' },
];

/**
 * Bons d'achat de la boutique (hors ligne) : bons émis (à recevoir) et reçus, recherche par
 * numéro ou fournisseur ; un bon s'ouvre pour la réception, le paiement ou une correction.
 */
export default function Achats() {
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const [filtre, setFiltre] = useState<Filtre>('TOUS');
  const [recherche, setRecherche] = useState('');
  const achats = useLecture((b) => achatsDeLaBoutique(b, boutique?.id ?? ''), [boutique?.id]);
  const monnaie = profil?.commerce.monnaie;

  const mot = recherche.trim().toLowerCase();
  const visibles = (achats ?? []).filter((a) => {
    const statut =
      filtre === 'TOUS' ||
      (filtre === 'A_RECEVOIR' && (a.statut === 'BROUILLON' || a.statut === 'PARTIEL')) ||
      (filtre === 'RECUS' && a.statut === 'RECU') ||
      (filtre === 'ANNULES' && a.statut === 'ANNULE');
    const texte =
      !mot ||
      a.numero.toLowerCase().includes(mot) ||
      (a.fournisseur ?? '').toLowerCase().includes(mot);
    return statut && texte;
  });

  return (
    <Ecran titre="Bons d’achat" sousTitre={boutique?.nom} enHaut>
      <Bouton
        titre="Ajouter du stock (nouveau bon)"
        icone="add-circle"
        onPress={() => router.push('/achat/edition')}
      />
      <Champ
        libelle="Rechercher (numéro du bon ou fournisseur)"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
      />
      <View style={styles.filtres} accessibilityRole="tablist">
        {FILTRES.map((f) => {
          const actif = f.valeur === filtre;
          return (
            <Pressable
              key={f.valeur}
              accessibilityRole="tab"
              accessibilityState={{ selected: actif }}
              onPress={() => setFiltre(f.valeur)}
              style={[
                styles.filtre,
                {
                  borderColor: actif ? c.bouton : c.bordure,
                  backgroundColor: actif ? c.bouton : c.carte,
                },
              ]}
            >
              <Text style={{ color: actif ? c.texteEnTete : c.texte, fontWeight: '700' }}>
                {f.libelle}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {achats && visibles.length === 0 ? <Texte discret>Aucun bon d’achat.</Texte> : null}
      {visibles.map((a) => {
        const reste = a.statut === 'ANNULE' ? 0 : a.montantTotal - a.montantPaye;
        const aRecevoir = a.statut === 'BROUILLON' || a.statut === 'PARTIEL';
        return (
          <View
            key={a.id}
            style={[styles.ligne, { borderColor: c.bordure, backgroundColor: c.carte }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir le bon ${a.numero}`}
              onPress={() => router.push({ pathname: '/achat/[id]', params: { id: a.id } })}
              style={styles.texte}
            >
              <Text style={[styles.nom, { color: c.texte }]}>
                {a.numero} · {a.fournisseur}
              </Text>
              <Text style={{ color: c.texteDiscret }}>
                {new Date(`${a.dateAchat}T12:00:00`).toLocaleDateString('fr-FR')} ·{' '}
                {formaterMontant(a.montantTotal, monnaie)}
                {reste > 0 ? ` · reste dû ${formaterMontant(reste, monnaie)}` : ''}
              </Text>
              <Text style={[styles.statut, { color: aRecevoir ? c.alerte : c.succes }]}>
                {LIBELLES_STATUTS_ACHAT[a.statut]}
              </Text>
            </Pressable>
            {a.statut !== 'ANNULE' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Modifier le bon ${a.numero}`}
                onPress={() => router.push({ pathname: '/achat/edition', params: { id: a.id } })}
                style={({ pressed }) => [
                  styles.modifier,
                  { borderColor: c.primaire, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Ionicons name="create" size={18} color={c.primaire} />
                <Text style={{ color: c.primaire, fontWeight: '700' }}>Modifier</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  filtres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filtre: { borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
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
  modifier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
