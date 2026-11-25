import Ionicons from '@expo/vector-icons/Ionicons';
import { type Href, router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NomIcone } from '@/components/ui';
import { useCompteurs } from '@/lib/compteurs';
import { usePlateforme } from '@/lib/plateforme';
import { ombre, useCouleurs } from '@/lib/theme';

export interface Onglet {
  titre: string;
  icone: NomIcone;
  iconeActive: NomIcone;
  /** Écran de l'onglet ; absent : `action` (ex. Quitter). */
  chemin?: Href & string;
  action?: () => void;
  /** Écrans rattachés à l'onglet (il reste allumé dans leurs sous-écrans). */
  prefixes?: string[];
  /** Gros bouton rond au centre (l'action principale). */
  central?: boolean;
  pastille?: number;
}

function estActif(onglet: Onglet, chemin: string) {
  if (!onglet.chemin) return false;
  if (chemin === onglet.chemin) return true;
  return (onglet.prefixes ?? []).some((p) => chemin === p || chemin.startsWith(`${p}/`));
}

/**
 * Barre d'onglets toujours visible en bas de l'écran : les endroits les plus utilisés,
 * l'action principale en gros bouton au centre. Un appui ramène toujours au même écran.
 */
export function BarreOnglets({ onglets }: { onglets: Onglet[] }) {
  const c = useCouleurs();
  const chemin = usePathname();

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
        {onglets.map((o) => {
          const actif = estActif(o, chemin);
          const couleur = o.central ? '#1E2235' : actif ? c.primaire : c.texteDiscret;
          const appui = () => {
            if (o.action) o.action();
            else if (o.chemin && chemin !== o.chemin) router.navigate(o.chemin);
          };
          return (
            <Pressable
              key={o.titre}
              accessibilityRole="tab"
              accessibilityState={{ selected: actif }}
              accessibilityLabel={o.pastille ? `${o.titre} (${o.pastille})` : o.titre}
              onPress={appui}
              style={({ pressed }) => [styles.onglet, { opacity: pressed ? 0.7 : 1 }]}
            >
              {o.central ? (
                <View
                  style={[styles.boutonCentral, ombre(c.ombre, 4), { backgroundColor: c.accent }]}
                >
                  <Ionicons name={o.iconeActive} size={26} color={couleur} />
                </View>
              ) : (
                <View style={[styles.pastilleIcone, actif && { backgroundColor: c.fondPrimaire }]}>
                  <Ionicons name={actif ? o.iconeActive : o.icone} size={24} color={couleur} />
                  {o.pastille ? (
                    <View style={[styles.badge, { backgroundColor: c.boutonDanger }]}>
                      <Text style={styles.texteBadge}>{o.pastille > 99 ? '99+' : o.pastille}</Text>
                    </View>
                  ) : null}
                </View>
              )}
              <Text
                numberOfLines={1}
                style={[
                  styles.texte,
                  {
                    color: o.central ? c.texte : couleur,
                    fontWeight: actif || o.central ? '800' : '600',
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

/** Espace commerçant : Accueil, Stock, Vendre (au centre), Clients, Menu. */
export function BarreCommercant() {
  const { synchronisation, caissesAValider } = useCompteurs();
  return (
    <BarreOnglets
      onglets={[
        { chemin: '/', titre: 'Accueil', icone: 'home-outline', iconeActive: 'home' },
        {
          chemin: '/stock',
          titre: 'Stock',
          icone: 'cube-outline',
          iconeActive: 'cube',
          prefixes: ['/stock', '/produit', '/imei', '/achat', '/achats'],
        },
        {
          chemin: '/vente',
          titre: 'Vendre',
          icone: 'cart-outline',
          iconeActive: 'cart',
          prefixes: ['/vente'],
          central: true,
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
          pastille: synchronisation + caissesAValider,
        },
      ]}
    />
  );
}

/** Espace concepteur : Commerçants, Tableau, Nouveau (au centre), Comptes, Quitter. */
export function BarreConcepteur() {
  const { deconnexion, demandesEnAttente } = usePlateforme();
  return (
    <BarreOnglets
      onglets={[
        {
          chemin: '/plateforme',
          titre: 'Commerçants',
          icone: 'storefront-outline',
          iconeActive: 'storefront',
          prefixes: ['/plateforme/commerce', '/plateforme/demandes'],
          // Demandes « Mot de passe oublié » des commerçants en attente.
          pastille: demandesEnAttente,
        },
        {
          chemin: '/plateforme/tableau',
          titre: 'Tableau',
          icone: 'stats-chart-outline',
          iconeActive: 'stats-chart',
          prefixes: ['/plateforme/tableau'],
        },
        {
          chemin: '/plateforme/nouveau',
          titre: 'Nouveau',
          icone: 'add-circle-outline',
          iconeActive: 'add',
          prefixes: ['/plateforme/nouveau'],
          central: true,
        },
        {
          chemin: '/plateforme/concepteurs',
          titre: 'Comptes',
          icone: 'people-circle-outline',
          iconeActive: 'people-circle',
          prefixes: ['/plateforme/concepteurs', '/plateforme/compte'],
        },
        {
          titre: 'Quitter',
          icone: 'log-out-outline',
          iconeActive: 'log-out',
          action: () => void deconnexion(),
        },
      ]}
    />
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
    paddingTop: 4,
    paddingBottom: 4,
  },
  onglet: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'flex-end' },
  pastilleIcone: {
    width: 56,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boutonCentral: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginTop: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texte: { fontSize: 12 },
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
