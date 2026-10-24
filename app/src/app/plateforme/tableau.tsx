import {
  formaterMontant,
  LIBELLES_ETATS_ABONNEMENT,
  LIBELLES_FORMULES,
  LIBELLES_MOYENS,
} from '@gestvente/commun';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BadgeAbonnement, dateCourte } from '@/components/plateforme';
import { Carte, Ecran, Grille, Indicateur, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { type TableauPlateforme, usePlateforme } from '@/lib/plateforme';
import { useCouleurs } from '@/lib/theme';

/** Tableau du concepteur : commerces, abonnements, encaissements (GNF) et échéances proches. */
export default function TableauConcepteur() {
  const c = useCouleurs();
  const { requete } = usePlateforme();
  const [tableau, setTableau] = useState<TableauPlateforme | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(
    () =>
      requete<TableauPlateforme>('/tableau').then(
        (r) => {
          setTableau(r);
          setErreur(null);
        },
        (e: unknown) => setErreur(messageErreur(e)),
      ),
    [requete],
  );

  useEffect(() => {
    void charger();
  }, [charger]);

  const ouvrir = (id: string) => () =>
    router.push({ pathname: '/plateforme/commerce/[id]', params: { id } });

  if (!tableau) {
    return (
      <Ecran enHaut titre="Tableau de bord">
        <Message texte={erreur} />
        {!erreur ? <Texte discret>Chargement…</Texte> : null}
      </Ecran>
    );
  }
  const a = tableau.abonnements;

  return (
    <Ecran enHaut titre="Tableau de bord" sousTitre="Commerçants abonnés à la plateforme">
      <Message texte={erreur} />
      <Grille>
        <Indicateur
          libelle="Encaissé ce mois"
          valeur={formaterMontant(tableau.encaisse.mois.montant, 'GNF')}
          detail={`${tableau.encaisse.mois.paiements} paiement(s)`}
          icone="cash"
          couleur={c.succes}
          large
        />
        <Indicateur
          libelle="Encaissé cette année"
          valeur={formaterMontant(tableau.encaisse.annee.montant, 'GNF')}
          detail={`${tableau.encaisse.annee.paiements} paiement(s)`}
          icone="wallet"
          large
        />
        <Indicateur
          libelle="Commerces en service"
          valeur={String(tableau.commerces.actifs)}
          detail={`${tableau.commerces.nouveauxCeMois} nouveau(x) ce mois`}
          icone="storefront"
        />
        <Indicateur
          libelle="Suspendus"
          valeur={String(tableau.commerces.suspendus)}
          icone="pause-circle"
          couleur={tableau.commerces.suspendus ? c.alerte : c.succes}
        />
        <Indicateur libelle="En essai" valeur={String(a.ESSAI)} icone="gift" couleur={c.primaire} />
        <Indicateur
          libelle="Abonnés"
          valeur={String(a.ACTIF + a.A_RENOUVELER)}
          detail={`${a.A_RENOUVELER} à renouveler`}
          icone="checkmark-circle"
          couleur={c.succes}
        />
        <Indicateur
          libelle="Échus ou expirés"
          valeur={String(a.EN_GRACE + a.EXPIRE)}
          detail={`${a.EXPIRE} sans accès`}
          icone="alert-circle"
          couleur={a.EN_GRACE + a.EXPIRE ? c.danger : c.succes}
        />
      </Grille>

      <Carte titre="Échéances (7 jours et retards)" icone="calendar">
        {tableau.echeances.length === 0 ? <Texte discret>Aucune échéance proche.</Texte> : null}
        {tableau.echeances.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={`${e.nom}, ${LIBELLES_ETATS_ABONNEMENT[e.etat]}`}
            onPress={ouvrir(e.id)}
            style={[styles.ligne, { borderColor: c.bordure }]}
          >
            <View style={{ flex: 1 }}>
              <Texte gras>{e.nom}</Texte>
              <Texte discret>Échéance : {dateCourte(e.jusquAu)}</Texte>
            </View>
            <BadgeAbonnement etat={e.etat} joursRestants={e.joursRestants} />
          </Pressable>
        ))}
      </Carte>

      <Carte titre="Derniers paiements" icone="receipt">
        {tableau.derniersPaiements.length === 0 ? (
          <Texte discret>Aucun paiement enregistré.</Texte>
        ) : null}
        {tableau.derniersPaiements.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={ouvrir(p.commerceId)}
            style={[styles.ligne, { borderColor: c.bordure }]}
          >
            <View style={{ flex: 1 }}>
              <Texte gras>{p.commerce}</Texte>
              <Texte discret>
                {dateCourte(p.creeLe)} · {LIBELLES_FORMULES[p.formule]} × {p.periodes} ·{' '}
                {LIBELLES_MOYENS[p.moyen]}
              </Texte>
            </View>
            <Texte gras>{formaterMontant(p.montant, 'GNF')}</Texte>
          </Pressable>
        ))}
      </Carte>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 8,
  },
});
