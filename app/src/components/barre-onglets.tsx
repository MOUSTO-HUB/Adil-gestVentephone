import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NomIcone } from '@/components/ui';
import { useCompteurs } from '@/lib/compteurs';
import { ombre, useCouleurs } from '@/lib/theme';

type Chemin = '/' | '/vente' | '/stock' | '/clients' | '/menu';

interface Onglet {
  chemin: Chemin;
  titre: string;
  icone: NomIcone;
  iconeActive: NomIcone;
  /** Écrans rattachés à l'onglet (il reste allumé dans leurs sous-écrans). */
  prefixes: string[];
}

const ONGLETS: Onglet[] = [
  { chemin: '/', titre: 'Accueil', icone: 'home-outline', iconeActive: 'home', prefixes: [] },
  {
    chemin: '/stock',
    titre: 'Stock',
    icone: 'cube-outline',
    iconeActive: 'cube',
    prefixes: ['/stock', '/produit', '/imei'],
  },
  {
    chemin: '/vente',
    titre: 'Vendre',
    icone: 'cart-outline',
    iconeActive: 'cart',
    prefixes: ['/vente'],
  },
  {
    chemin: '/clients',
    titre: 'Clients',
    icone: 'people-outline',
    iconeActive: 'people',
    prefixes: ['/clients', '/client'],
  },
  {
    chemin: '/menu',
    titre: 'Menu',
    icone: 'grid-outline',
    iconeActive: 'grid',
    prefixes: ['/menu'],
  },
];

function estActif(onglet: Onglet, chemin: string) {
  if (onglet.chemin === '/') return chemin === '/';
  return onglet.prefixes.some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

/**
 * Barre d'onglets toujours visible en bas de l'espace commerçant : les 5 endroits les plus
 * utilisés, avec un gros bouton « Vendre » au centre. Un appui ramène toujours au même écran.
 */
export function BarreOnglets() {
  const c = useCouleurs();
  const chemin = usePathname();
  const { synchronisation, caissesAValider } = useCompteurs();
  const pastilleMenu = synchronisation + caissesAValider;

  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={[
        styles.barre,
        ombre(c.ombre, 6),
        { backgroundColor: c.carte, borderTopColor: c.bordure },
      ]}
    >
      <View style={styles.ligne} accessibilityRole="tablist">
        {ONGLETS.map((o) => {
          const actif = estActif(o, chemin);
          const vendre = o.chemin === '/vente';
          const couleur = vendre ? '#1E2235' : actif ? c.primaire : c.texteDiscret;
          const pastille = o.chemin === '/menu' ? pastilleMenu : 0;
          return (
            <Pressable
              key={o.chemin}
              accessibilityRole="tab"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={pastille ? `${o.titre} (${pastille})` : o.titre}
              // Retour direct à l'écran de l'onglet, sans empiler les écrans.
              onPress={() => (actif && chemin === o.chemin ? undefined : router.navigate(o.chemin))}
              style={({ pressed }) => [styles.onglet, { opacity: pressed ? 0.7 : 1 }]}
            >
              {vendre ? (
                <View
                  style={[styles.boutonVendre, ombre(c.ombre, 4), { backgroundColor: c.accent }]}
                >
                  <Ionicons name="cart" size={30} color={couleur} />
                </View>
              ) : (
                <View style={[styles.pastilleIcone, actif && { backgroundColor: c.fondPrimaire }]}>
                  <Ionicons name={actif ? o.iconeActive : o.icone} size={26} color={couleur} />
                  {pastille ? (
                    <View style={[styles.badge, { backgroundColor: c.boutonDanger }]}>
                      <Text style={styles.texteBadge}>{pastille > 99 ? '99+' : pastille}</Text>
                    </View>
                  ) : null}
                </View>
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.texte,
                  {
                    color: vendre ? c.texte : couleur,
                    fontWeight: actif || vendre ? '800' : '600',
                  },
                ]}
              >
                {o.titre}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  barre: { borderTopWidth: 1 },
  ligne: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 6,
  },
  onglet: { flex: 1, alignItems: 'center', gap: 3, minHeight: 56, justifyContent: 'flex-end' },
  pastilleIcone: {
    width: 56,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boutonVendre: {
    width: 62,
    height: 62,
    borderRadius: 31,
    marginTop: -26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texte: { fontSize: 13 },
  badge: {
    position: 'absolute',
    top: -4,
    right: 6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texteBadge: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
});
