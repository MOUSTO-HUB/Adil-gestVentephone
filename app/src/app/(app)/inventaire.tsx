import { ecartQuantite, ecartsTelephones, schemaInventaire } from '@gestvente/commun';
import * as Crypto from 'expo-crypto';
import { router, useTheme } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SaisieImei } from '@/components/saisie-imei';
import { Bouton, Carte, Champ, Ecran, Message, Texte } from '@/components/ui';
import { ecrireMeta, lireMeta } from '@/lib/base/depot';
import type { BaseSql } from '@/lib/base/sql';
import { rechercherProduits } from '@/lib/catalogue';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';

interface LigneComptage {
  produitId: string;
  nom: string;
  type: 'TELEPHONE' | 'ACCESSOIRE';
  quantite: string;
  imeis: string[];
}

interface Brouillon {
  motif: string;
  lignes: LigneComptage[];
}

const cleBrouillon = (boutiqueId: string) => `inventaire-brouillon:${boutiqueId}`;

/**
 * Inventaire physique (propriétaire et gérants) : on compte les accessoires, on scanne
 * les téléphones ; les écarts s'affichent au fur et à mesure. Le comptage en cours est
 * gardé sur l'appareil ; à la validation, le stock suit le comptage.
 */
export default function Inventaire() {
  const { boutique } = useSession();
  const brouillon = useLecture(
    async (b) => {
      const texte = await lireMeta(b, cleBrouillon(boutique?.id ?? ''));
      return texte ? (JSON.parse(texte) as Brouillon) : { motif: '', lignes: [] };
    },
    [boutique?.id],
  );
  if (!brouillon || !boutique)
    return (
      <Ecran titre="Inventaire" enHaut>
        {null}
      </Ecran>
    );
  return <Comptage initial={brouillon} boutiqueId={boutique.id} boutiqueNom={boutique.nom} />;
}

interface Theorique {
  quantites: Map<string, number>;
  telephones: Map<string, { id: string; imei: string }[]>;
}

async function lireTheorique(
  b: BaseSql,
  boutiqueId: string,
  produitIds: string[],
): Promise<Theorique> {
  const quantites = new Map<string, number>();
  const telephones = new Map<string, { id: string; imei: string }[]>();
  for (const id of produitIds) {
    const stock = await b.premier<{ quantite: number }>(
      'SELECT quantite FROM stock WHERE produitId = ? AND boutiqueId = ?',
      [id, boutiqueId],
    );
    quantites.set(id, stock?.quantite ?? 0);
    telephones.set(
      id,
      await b.tous(
        "SELECT id, imei FROM article WHERE produitId = ? AND boutiqueId = ? AND statut IN ('EN_STOCK', 'A_REPARER')",
        [id, boutiqueId],
      ),
    );
  }
  return { quantites, telephones };
}

function Comptage({
  initial,
  boutiqueId,
  boutiqueNom,
}: {
  initial: Brouillon;
  boutiqueId: string;
  boutiqueNom: string;
}) {
  const { colors } = useTheme();
  const { base, enregistrer } = useSync();
  const [brouillon, setBrouillon] = useState<Brouillon>(initial);
  const [recherche, setRecherche] = useState('');
  const [message, setMessage] = useState<{ texte: string; type: 'erreur' | 'info' } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const produitIds = brouillon.lignes.map((l) => l.produitId);
  const theorique = useLecture(
    (b) => lireTheorique(b, boutiqueId, produitIds),
    [boutiqueId, produitIds.join(',')],
  );
  const resultats = useLecture(
    async (b) =>
      recherche.trim() ? rechercherProduits(b, boutiqueId, recherche, { limite: 8 }) : [],
    [recherche, boutiqueId],
  );

  const modifier = (suivant: Brouillon) => {
    setBrouillon(suivant);
    if (base) void ecrireMeta(base, cleBrouillon(boutiqueId), JSON.stringify(suivant));
  };
  const modifierLigne = (produitId: string, changement: Partial<LigneComptage>) =>
    modifier({
      ...brouillon,
      lignes: brouillon.lignes.map((l) =>
        l.produitId === produitId ? { ...l, ...changement } : l,
      ),
    });

  const ajouter = (p: { id: string; nom: string; type: 'TELEPHONE' | 'ACCESSOIRE' }) => {
    setRecherche('');
    if (brouillon.lignes.some((l) => l.produitId === p.id)) return;
    modifier({
      ...brouillon,
      lignes: [
        ...brouillon.lignes,
        { produitId: p.id, nom: p.nom, type: p.type, quantite: '', imeis: [] },
      ],
    });
  };

  const valider = async () => {
    setMessage(null);
    const saisie = schemaInventaire.safeParse({
      id: Crypto.randomUUID(),
      motif: brouillon.motif,
      lignes: brouillon.lignes.map((l) =>
        l.type === 'ACCESSOIRE'
          ? { produitId: l.produitId, quantiteComptee: Number(l.quantite.replace(/\s/g, '')) }
          : { produitId: l.produitId, imeis: l.imeis },
      ),
    });
    if (
      !saisie.success ||
      brouillon.lignes.some((l) => l.type === 'ACCESSOIRE' && !/^\d+$/.test(l.quantite.trim()))
    ) {
      setMessage({
        texte: saisie.success
          ? 'Indiquez la quantité comptée de chaque accessoire.'
          : saisie.error.issues.map((i) => i.message).join('\n'),
        type: 'erreur',
      });
      return;
    }
    if (
      !(await confirmer(
        'Valider l’inventaire ? Le stock sera ajusté au comptage (téléphones non scannés sortis du stock).',
        'Valider',
      ))
    ) {
      return;
    }
    setEnvoi(true);
    try {
      await enregistrer({ type: 'INVENTAIRE_VALIDER', boutiqueId, contenu: saisie.data });
      modifier({ motif: '', lignes: [] });
      setMessage({ texte: 'Inventaire validé : le stock est ajusté.', type: 'info' });
    } catch (e) {
      setMessage({ texte: (e as Error).message, type: 'erreur' });
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Ecran titre="Inventaire" sousTitre={boutiqueNom} enHaut>
      <Champ
        libelle="Motif (obligatoire)"
        value={brouillon.motif}
        onChangeText={(motif) => modifier({ ...brouillon, motif })}
        placeholder="Inventaire de fin de mois"
      />
      <Champ
        libelle="Ajouter un produit à compter"
        value={recherche}
        onChangeText={setRecherche}
        autoCorrect={false}
      />
      {resultats?.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          onPress={() => ajouter(p)}
          style={[styles.resultat, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <Text style={{ color: colors.text }}>+ {p.nom}</Text>
        </Pressable>
      ))}
      {brouillon.lignes.length === 0 ? (
        <Texte discret>Ajoutez les produits que vous comptez : seuls ceux-là seront ajustés.</Texte>
      ) : null}

      {brouillon.lignes.map((l) => {
        const enStock = theorique?.quantites.get(l.produitId) ?? 0;
        return (
          <Carte key={l.produitId}>
            <View style={styles.entete}>
              <Texte gras>{l.nom}</Texte>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${l.nom} du comptage`}
                onPress={() =>
                  modifier({
                    ...brouillon,
                    lignes: brouillon.lignes.filter((x) => x.produitId !== l.produitId),
                  })
                }
              >
                <Text style={{ color: colors.notification, fontWeight: '700' }}>Retirer</Text>
              </Pressable>
            </View>
            {l.type === 'ACCESSOIRE' ? (
              <>
                <Texte discret>En stock selon le système : {enStock}</Texte>
                <TextInput
                  value={l.quantite}
                  onChangeText={(quantite) => modifierLigne(l.produitId, { quantite })}
                  keyboardType="number-pad"
                  placeholder="Quantité comptée"
                  placeholderTextColor="#8a8a8a"
                  accessibilityLabel={`Quantité comptée de ${l.nom}`}
                  style={[styles.saisie, { color: colors.text, borderColor: colors.border }]}
                />
                {/^\d+$/.test(l.quantite.trim()) ? (
                  <Ecart valeur={ecartQuantite(enStock, Number(l.quantite.trim()))} />
                ) : null}
              </>
            ) : (
              <EcartTelephones
                ligne={l}
                enStock={theorique?.telephones.get(l.produitId) ?? []}
                surImeis={(imeis) => modifierLigne(l.produitId, { imeis })}
              />
            )}
          </Carte>
        );
      })}
      <Message texte={message?.texte ?? null} type={message?.type} />
      {brouillon.lignes.length ? (
        <Bouton titre="Valider l’inventaire" onPress={() => void valider()} chargement={envoi} />
      ) : null}
      <Bouton titre="Retour" variante="secondaire" onPress={() => router.back()} />
    </Ecran>
  );
}

function Ecart({ valeur }: { valeur: number }) {
  const { colors } = useTheme();
  const texte =
    valeur === 0 ? 'Aucun écart' : valeur > 0 ? `Surplus de ${valeur}` : `Manque ${-valeur}`;
  return (
    <Text style={{ color: valeur === 0 ? colors.text : colors.notification, fontWeight: '600' }}>
      {texte}
    </Text>
  );
}

function EcartTelephones({
  ligne,
  enStock,
  surImeis,
}: {
  ligne: LigneComptage;
  enStock: { id: string; imei: string }[];
  surImeis: (imeis: string[]) => void;
}) {
  const ecarts = ecartsTelephones(enStock, ligne.imeis);
  return (
    <>
      <Texte discret>
        En stock selon le système : {enStock.length} · scannés présents : {ecarts.presents.length}
      </Texte>
      <SaisieImei libelle="IMEI scannés en rayon" imeis={ligne.imeis} surChangement={surImeis} />
      <Ecart valeur={-ecarts.manquants.length} />
      {ecarts.manquants.length ? (
        <Texte discret>
          Non scannés (sortiront du stock) : {ecarts.manquants.map((a) => a.imei).join(', ')}
        </Texte>
      ) : null}
      {ecarts.inconnus.length ? (
        <Message
          texte={`Scannés mais absents du stock de la boutique : ${ecarts.inconnus.join(', ')}`}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  resultat: { borderWidth: 1, borderRadius: 8, padding: 10 },
  entete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  saisie: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
});
