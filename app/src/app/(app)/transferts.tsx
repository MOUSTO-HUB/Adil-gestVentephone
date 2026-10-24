import {
  formaterDate,
  LIBELLES_STATUTS_TRANSFERT,
  peutGererSessions,
  type StatutTransfert,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Ecran, Texte } from '@/components/ui';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { ombre, useCouleurs } from '@/lib/theme';
import { boutiquesDuCommerce, type FiltreTransferts, listeTransferts } from '@/lib/transferts';

const FILTRES: { id: FiltreTransferts; nom: string }[] = [
  { id: 'A_RECEVOIR', nom: 'À recevoir' },
  { id: 'A_PREPARER', nom: 'À préparer' },
  { id: 'TOUS', nom: 'Tous' },
];

/** Transferts de la boutique : à recevoir, à préparer (demandes reçues), historique. */
export default function Transferts() {
  const c = useCouleurs();
  const { profil, boutique, api } = useSession();
  const { base } = useSync();
  const [filtre, setFiltre] = useState<FiltreTransferts>('A_RECEVOIR');
  const boutiqueId = boutique?.id ?? '';
  const liste = useLecture((b) => listeTransferts(b, boutiqueId, filtre), [boutiqueId, filtre]);
  const boutiques = useLecture(
    (b) => boutiquesDuCommerce(b, api, profil?.boutiques ?? []),
    [api, profil?.boutiques],
  );

  if (!profil || !boutique || !base)
    return (
      <Ecran titre="Transferts" enHaut>
        {null}
      </Ecran>
    );
  const nom = (id: string) => boutiques?.find((b) => b.id === id)?.nom ?? 'autre boutique';
  const fuseau = profil.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const couleurs: Record<StatutTransfert, string> = {
    DEMANDE: c.alerte,
    ENVOYE: c.primaire,
    RECU: c.succes,
    ANNULE: c.texteDiscret,
  };

  return (
    <Ecran titre="Transferts" sousTitre={boutique.nom} enHaut>
      {peutGererSessions(profil.role) ? (
        <Bouton
          titre="Demander du stock à une autre boutique"
          icone="download-outline"
          onPress={() =>
            router.push({ pathname: '/transfert/nouveau', params: { mode: 'demande' } })
          }
        />
      ) : null}
      {profil.role === 'PROPRIETAIRE' ? (
        <Bouton
          titre="Envoyer directement"
          icone="paper-plane-outline"
          variante="secondaire"
          onPress={() => router.push({ pathname: '/transfert/nouveau', params: { mode: 'envoi' } })}
        />
      ) : null}
      <Choix
        libelle="Afficher"
        options={FILTRES}
        valeurs={[filtre]}
        surChoix={([v]) => v && setFiltre(v as FiltreTransferts)}
      />
      {liste?.length === 0 ? <Texte discret>Aucun transfert.</Texte> : null}
      {liste?.map((t) => {
        const sortant = t.boutiqueDepartId === boutiqueId;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/transfert/[id]', params: { id: t.id } })}
            style={({ pressed }) => [
              styles.carte,
              ombre(c.ombre, 1),
              { backgroundColor: c.carte, borderColor: c.bordure, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.ligne}>
              <Text style={[styles.titre, { color: c.texte }]}>
                {sortant ? `Vers ${nom(t.boutiqueArriveeId)}` : `Depuis ${nom(t.boutiqueDepartId)}`}
              </Text>
              <Text style={{ color: couleurs[t.statut], fontWeight: '700' }}>
                {LIBELLES_STATUTS_TRANSFERT[t.statut]}
              </Text>
            </View>
            <Texte discret>
              {t.numero} · {formaterDate(t.envoyeLe ?? t.creeLe, fuseau)} · {t.pieces} pièce(s)
            </Texte>
            {t.note ? <Texte discret>{t.note}</Texte> : null}
          </Pressable>
        );
      })}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  carte: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  ligne: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  titre: { fontSize: 16, fontWeight: '700', flex: 1 },
});
