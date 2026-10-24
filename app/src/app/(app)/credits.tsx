import {
  formaterMontant,
  jourFr,
  jourLocal,
  LIBELLES_STATUTS_CREDIT,
  type StatutAfficheCredit,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Ecran, Indicateur, Texte } from '@/components/ui';
import { type FiltreCredits, listeCredits, totauxCredits } from '@/lib/credits';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { useSession } from '@/lib/session';
import { useLecture } from '@/lib/sync/contexte';
import { ombre, useCouleurs } from '@/lib/theme';

const FILTRES: { id: FiltreCredits; nom: string }[] = [
  { id: 'EN_COURS', nom: 'En cours' },
  { id: 'EN_RETARD', nom: 'En retard' },
  { id: 'SOLDE', nom: 'Soldés' },
  { id: 'TOUS', nom: 'Tous' },
];

/** Tableau des crédits de la boutique : en cours, en retard, soldés ; total dû. */
export default function Credits() {
  const c = useCouleurs();
  const { profil, boutique } = useSession();
  const [filtre, setFiltre] = useState<FiltreCredits>('EN_COURS');
  const boutiqueId = boutique?.id ?? '';
  const aujourdhui = jourLocal(new Date(), profil?.commerce.fuseau ?? FUSEAU_PAR_DEFAUT);
  const credits = useLecture(
    (b) => listeCredits(b, boutiqueId, aujourdhui, filtre),
    [boutiqueId, aujourdhui, filtre],
  );
  const enCours = useLecture(
    (b) => listeCredits(b, boutiqueId, aujourdhui, 'EN_COURS'),
    [boutiqueId, aujourdhui],
  );

  if (!profil || !boutique)
    return (
      <Ecran titre="Crédits" enHaut>
        {null}
      </Ecran>
    );
  const monnaie = profil.commerce.monnaie;
  const totaux = totauxCredits(enCours ?? []);
  const couleurs: Record<StatutAfficheCredit, [string, string]> = {
    EN_COURS: [c.primaire, c.fondPrimaire],
    EN_RETARD: [c.danger, c.fondDanger],
    SOLDE: [c.succes, c.fondSucces],
    ANNULE: [c.texteDiscret, c.fond],
  };

  return (
    <Ecran titre="Crédits" sousTitre={boutique.nom} enHaut>
      <View style={styles.indicateurs}>
        <Indicateur
          libelle="Total dû"
          valeur={formaterMontant(totaux.du, monnaie)}
          icone="wallet"
          large
        />
        <Indicateur
          libelle="Échu à ce jour"
          valeur={formaterMontant(totaux.echu, monnaie)}
          icone="alarm"
          couleur={c.alerte}
        />
        <Indicateur
          libelle="Clients en retard"
          valeur={String(totaux.enRetard)}
          icone="warning"
          couleur={c.danger}
        />
      </View>
      {profil.role !== 'VENDEUR' ? (
        <Bouton
          titre="Rappels et pénalités"
          icone="notifications-outline"
          variante="secondaire"
          onPress={() => router.push('/rappels')}
        />
      ) : null}
      <Choix
        libelle="Afficher"
        options={FILTRES}
        valeurs={[filtre]}
        surChoix={([v]) => v && setFiltre(v as FiltreCredits)}
      />
      {credits?.length === 0 ? (
        <Texte discret>Aucun crédit. Une vente à crédit se fait depuis l’écran de vente.</Texte>
      ) : null}
      {credits?.map((cr) => {
        const [couleur, fond] = couleurs[cr.situation.statut];
        return (
          <Pressable
            key={cr.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/credit/[id]', params: { id: cr.id } })}
            style={({ pressed }) => [
              styles.carte,
              ombre(c.ombre, 1),
              { backgroundColor: c.carte, borderColor: c.bordure, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.ligne}>
              <Text style={[styles.nom, { color: c.texte }]} numberOfLines={1}>
                {cr.client}
              </Text>
              <View style={[styles.badge, { backgroundColor: fond }]}>
                <Text style={{ color: couleur, fontWeight: '700', fontSize: 12 }}>
                  {LIBELLES_STATUTS_CREDIT[cr.situation.statut]}
                  {cr.situation.joursRetard ? ` · ${cr.situation.joursRetard} j` : ''}
                </Text>
              </View>
            </View>
            <Texte discret>
              Facture {cr.numeroVente} · {cr.telephone}
            </Texte>
            <Texte>
              Reste dû {formaterMontant(cr.situation.restant, monnaie)} sur{' '}
              {formaterMontant(cr.montantFinance, monnaie)}
            </Texte>
            {cr.situation.prochaine ? (
              <Texte discret>
                Tranche {cr.situation.prochaine.numero}/{cr.nombreTranches} le{' '}
                {jourFr(cr.situation.prochaine.date)} :{' '}
                {formaterMontant(cr.situation.prochaine.reste, monnaie)}
              </Texte>
            ) : null}
          </Pressable>
        );
      })}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  indicateurs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  carte: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nom: { flex: 1, fontSize: 16, fontWeight: '700' },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
});
