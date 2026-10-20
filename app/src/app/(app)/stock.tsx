import { formaterMontant, peutGererSessions } from '@gestvente/commun';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PhotoProduit } from '@/components/photo-produit';
import { Scanner, scannerDisponible } from '@/components/scanner';
import { Bouton, Champ, Ecran, Message, Texte } from '@/components/ui';
import { rechercherProduits, trouverParCode } from '@/lib/catalogue';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

/**
 * Catalogue et stock de la boutique, lus dans la base locale (hors ligne).
 * Recherche par mots, code-barres ou IMEI ; un code exact (lecteur USB qui tape
 * le code puis Entrée, ou caméra) ouvre directement la fiche.
 */
export default function Stock() {
  const { colors } = useTheme();
  const { profil, boutique } = useSession();
  const { base } = useSync();
  const gestion = !!profil && peutGererSessions(profil.role);
  const [recherche, setRecherche] = useState('');
  const [archives, setArchives] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const produits = useLecture(
    (b) => rechercherProduits(b, boutique?.id ?? '', recherche, { archives }),
    [boutique?.id, recherche, archives],
  );

  const ouvrirCode = async (code: string) => {
    if (!base || !boutique) return;
    const trouve = await trouverParCode(base, boutique.id, code);
    if (trouve) {
      setMessage(null);
      router.push({ pathname: '/produit/[id]', params: { id: trouve.produitId } });
    } else {
      setRecherche(code);
      setMessage(`Aucun produit avec le code ${code}.`);
    }
  };

  return (
    <Ecran titre="Stock" sousTitre={boutique?.nom} enHaut>
      <Champ
        libelle="Rechercher (nom, code-barres ou IMEI)"
        value={recherche}
        onChangeText={(t) => {
          setRecherche(t);
          setMessage(null);
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={!scannerDisponible}
        returnKeyType="search"
        onSubmitEditing={() => void ouvrirCode(recherche)}
      />
      {scannerDisponible ? (
        <Bouton titre="Scanner un code" variante="secondaire" onPress={() => setScanner(true)} />
      ) : null}
      <Message texte={message} />
      {gestion ? (
        <View style={styles.actions}>
          <View style={styles.action}>
            <Bouton titre="Nouveau produit" onPress={() => router.push('/produit/edition')} />
          </View>
          <View style={styles.action}>
            <Bouton
              titre="Importer (Excel)"
              variante="secondaire"
              onPress={() => router.push('/import')}
            />
          </View>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: archives }}
        onPress={() => setArchives((a) => !a)}
      >
        <Texte discret>{archives ? '☑' : '☐'} Montrer les produits archivés</Texte>
      </Pressable>

      {produits?.length === 0 ? <Texte discret>Aucun produit trouvé.</Texte> : null}
      {produits?.map((p) => {
        const alerte = p.seuilMinimum > 0 && p.quantite <= p.seuilMinimum;
        return (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/produit/[id]', params: { id: p.id } })}
            style={[styles.ligne, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <PhotoProduit photo={p.photo} nom={p.nom} taille={48} />
            <View style={styles.texte}>
              <Text style={[styles.nom, { color: colors.text }]}>
                {p.nom}
                {p.archive ? ' (archivé)' : ''}
              </Text>
              <Text style={{ color: colors.text, opacity: 0.65 }}>
                {formaterMontant(p.prixDetail, profil?.commerce.monnaie)}
              </Text>
            </View>
            <Text
              style={[styles.quantite, { color: alerte ? colors.notification : colors.text }]}
              accessibilityLabel={`${p.quantite} en stock${alerte ? ', stock bas' : ''}`}
            >
              {p.quantite}
            </Text>
          </Pressable>
        );
      })}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
      <Scanner
        visible={scanner}
        surCode={(code) => void ouvrirCode(code)}
        fermer={() => setScanner(false)}
      />
    </Ecran>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexBasis: 160 },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 12,
  },
  texte: { flex: 1, gap: 2 },
  nom: { fontSize: 16, fontWeight: '600' },
  quantite: { fontSize: 20, fontWeight: '700', minWidth: 36, textAlign: 'right' },
});
