import {
  type ChiffresBoutique,
  formaterDate,
  formaterMontant,
  jourLocal,
  rapportHtml,
  type SituationTrocs,
} from '@gestvente/commun';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Indicateur, Message, Texte } from '@/components/ui';
import { messageErreur } from '@/lib/api';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { exporterExcel } from '@/lib/export-excel';
import { imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import { useSession } from '@/lib/session';
import { useCouleurs } from '@/lib/theme';

type Ligne = ChiffresBoutique & { evolution: number | null };

interface Tableau {
  du: string;
  au: string;
  boutiques: Ligne[];
  total: Omit<ChiffresBoutique, 'boutiqueId' | 'nom'>;
  evolution: {
    chiffreAffaires: number | null;
    benefice: number | null;
    nombreVentes: number | null;
  };
  series: { cle: string; libelle: string; valeurs: Record<string, number> }[];
}

interface Archive {
  id: string;
  frequence: 'SEMAINE' | 'MOIS';
  du: string;
  au: string;
}

type ChoixPeriode = '7J' | '30J' | 'MOIS' | 'MOIS_PRECEDENT';
const PERIODES: { id: ChoixPeriode; nom: string }[] = [
  { id: '7J', nom: '7 jours' },
  { id: '30J', nom: '30 jours' },
  { id: 'MOIS', nom: 'Ce mois' },
  { id: 'MOIS_PRECEDENT', nom: 'Mois précédent' },
];

/** Bornes de la période choisie (jours au fuseau de la boutique, minuit UTC en Guinée). */
function bornes(choix: ChoixPeriode, fuseau: string) {
  const aujourdhui = jourLocal(new Date(), fuseau);
  const jour = (j: string) => new Date(`${j}T00:00:00Z`);
  const demain = new Date(jour(aujourdhui).getTime() + 86_400_000);
  if (choix === '7J') return { du: new Date(demain.getTime() - 7 * 86_400_000), au: demain };
  if (choix === '30J') return { du: new Date(demain.getTime() - 30 * 86_400_000), au: demain };
  const [a, m] = aujourdhui.split('-').map(Number);
  if (choix === 'MOIS') return { du: new Date(Date.UTC(a, m - 1, 1)), au: demain };
  return { du: new Date(Date.UTC(a, m - 2, 1)), au: new Date(Date.UTC(a, m - 1, 1)) };
}

const evolutionTexte = (e: number | null) =>
  e === null ? 'nouveau' : `${e > 0 ? '+' : ''}${e} % / période précédente`;

/**
 * Tableau de bord consolidé (en ligne) : ventes, bénéfice, stock, crédits, caisses
 * et dépenses de toutes les boutiques ou d'une seule, comparaison avec la période
 * précédente et entre boutiques, trocs, exports PDF et Excel, rapports planifiés.
 */
export default function TableauDeBord() {
  const c = useCouleurs();
  const { profil, api } = useSession();
  const [periode, setPeriode] = useState<ChoixPeriode>('30J');
  const [boutique, setBoutique] = useState('TOUTES');
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [trocs, setTrocs] = useState<{ total: SituationTrocs } | null>(null);
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  /** Heure du chargement (synchronisations anciennes : plus de 2 jours avant). */
  const [chargeLe, setChargeLe] = useState(0);
  const fuseau = profil?.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const proprietaire = profil?.role === 'PROPRIETAIRE';

  const requete = useCallback(() => {
    const { du, au } = bornes(periode, fuseau);
    const params = new URLSearchParams({
      du: du.toISOString(),
      au: au.toISOString(),
      regroupement: periode === '7J' ? 'jour' : 'semaine',
      ...(boutique !== 'TOUTES' ? { boutiqueId: boutique } : {}),
    });
    return params.toString();
  }, [periode, boutique, fuseau]);

  useEffect(() => {
    let actif = true;
    const q = requete();
    Promise.all([
      api.requete<Tableau>(`/tableau?${q}`),
      api.requete<{ total: SituationTrocs }>(`/tableau/trocs?${q}`),
      proprietaire ? api.requete<Archive[]>('/tableau/archives') : Promise.resolve(null),
    ]).then(
      ([t, tr, ar]) => {
        if (!actif) return;
        setTableau(t);
        setTrocs(tr);
        setArchives(ar);
        setChargeLe(Date.now());
        setMessage(null);
        setChargement(false);
      },
      (e: unknown) => {
        if (!actif) return;
        setMessage(messageErreur(e));
        setChargement(false);
      },
    );
    return () => {
      actif = false;
    };
  }, [api, requete, proprietaire]);

  if (!profil)
    return (
      <Ecran titre="Tableau de bord" enHaut>
        {null}
      </Ecran>
    );
  const monnaie = profil.commerce.monnaie;
  const m = (v: number) => formaterMontant(v, monnaie);
  const maxCa = Math.max(1, ...(tableau?.boutiques ?? []).map((b) => b.chiffreAffaires));
  const syncAncienne = (iso: string | null) =>
    !iso || chargeLe - new Date(iso).getTime() > 2 * 86_400_000;

  const pdf = () => {
    if (!tableau) return '';
    const libelle = PERIODES.find((p) => p.id === periode)!.nom;
    return rapportHtml('Tableau de bord', `${profil.commerce.nom} · ${libelle}`, [
      {
        titre: 'Par boutique',
        colonnes: [
          'Boutique',
          'Chiffre d’affaires',
          'Bénéfice',
          'Ventes',
          'Stock (vente)',
          'Crédits dus',
          'Échu',
          'Dépenses',
        ],
        lignes: [...tableau.boutiques, { ...tableau.total, nom: 'Total' }].map((b) => [
          b.nom,
          m(b.chiffreAffaires),
          m(b.benefice),
          String(b.nombreVentes),
          m(b.stockVente),
          m(b.creditsDu),
          m(b.creditsEchus),
          m(b.depenses),
        ]),
        aDroite: [1, 2, 3, 4, 5, 6, 7],
      },
      {
        titre: 'Évolution du chiffre d’affaires',
        colonnes: ['Période', ...tableau.boutiques.map((b) => b.nom)],
        lignes: tableau.series.map((s) => [
          s.libelle,
          ...tableau.boutiques.map((b) => m(s.valeurs[b.boutiqueId] ?? 0)),
        ]),
        aDroite: tableau.boutiques.map((_, i) => i + 1),
      },
      ...(trocs
        ? [
            {
              titre: 'Trocs',
              colonnes: ['Repris', 'Valeur de reprise', 'À réparer', 'Revendus', 'Ventes', 'Marge'],
              lignes: [
                [
                  String(trocs.total.repris),
                  m(trocs.total.valeurReprise),
                  String(trocs.total.aReparer),
                  String(trocs.total.revendus),
                  m(trocs.total.ventesRevendus),
                  m(trocs.total.marge),
                ],
              ],
              aDroite: [0, 1, 2, 3, 4, 5],
            },
          ]
        : []),
    ]);
  };

  const lancer = (tache: () => Promise<void>) =>
    tache().catch((e: unknown) => setMessage(messageErreur(e)));

  return (
    <Ecran titre="Tableau de bord" sousTitre={profil.commerce.nom} enHaut>
      <Choix
        libelle="Période"
        options={PERIODES}
        valeurs={[periode]}
        surChoix={([v]) => v && setPeriode(v as ChoixPeriode)}
      />
      {profil.boutiques.length > 1 ? (
        <Choix
          libelle="Boutiques"
          options={[
            { id: 'TOUTES', nom: 'Toutes' },
            ...profil.boutiques.map((b) => ({ id: b.id, nom: b.nom })),
          ]}
          valeurs={[boutique]}
          surChoix={([v]) => v && setBoutique(v)}
        />
      ) : null}
      <Message texte={message} />
      {chargement && !tableau ? <Texte discret>Chargement…</Texte> : null}

      {tableau ? (
        <>
          <View style={styles.grille}>
            <Indicateur
              libelle="Chiffre d’affaires"
              valeur={m(tableau.total.chiffreAffaires)}
              detail={evolutionTexte(tableau.evolution.chiffreAffaires)}
              icone="trending-up"
              couleur={c.succes}
              large
            />
            <Indicateur
              libelle="Bénéfice brut"
              valeur={m(tableau.total.benefice)}
              detail={evolutionTexte(tableau.evolution.benefice)}
              icone="cash"
            />
            <Indicateur
              libelle="Ventes"
              valeur={String(tableau.total.nombreVentes)}
              detail={evolutionTexte(tableau.evolution.nombreVentes)}
              icone="receipt"
            />
            <Indicateur
              libelle="Stock (prix de vente)"
              valeur={m(tableau.total.stockVente)}
              detail={`achat ${m(tableau.total.stockAchat)}`}
              icone="cube"
              large
            />
            <Indicateur
              libelle="Crédits en cours"
              valeur={m(tableau.total.creditsDu)}
              detail={`${tableau.total.creditsEnCours} crédit(s)`}
              icone="calendar"
            />
            <Indicateur
              libelle="Crédits en retard"
              valeur={m(tableau.total.creditsEchus)}
              detail={`${tableau.total.creditsEnRetard} client(s)`}
              icone="warning"
              couleur={c.danger}
            />
            <Indicateur
              libelle="Dépenses"
              valeur={m(tableau.total.depenses)}
              icone="wallet"
              couleur={c.alerte}
            />
            <Indicateur
              libelle="Caisses"
              valeur={`${tableau.total.caissesOuvertes} ouverte(s)`}
              detail={`${tableau.total.caissesAValider} à valider · écarts ${m(tableau.total.ecartsCaisse)}`}
              icone="cash-outline"
            />
          </View>

          <Carte titre="Par boutique" icone="storefront">
            {tableau.boutiques.map((b) => (
              <View key={b.boutiqueId} style={styles.boutique}>
                <View style={styles.ligne}>
                  <Text style={[styles.nom, { color: c.texte }]}>{b.nom}</Text>
                  <Texte gras>{m(b.chiffreAffaires)}</Texte>
                </View>
                <View style={[styles.barre, { backgroundColor: c.fondPrimaire }]}>
                  <View
                    style={[
                      styles.remplissage,
                      {
                        backgroundColor: c.primaire,
                        width: `${Math.max(2, (b.chiffreAffaires / maxCa) * 100)}%`,
                      },
                    ]}
                  />
                </View>
                <Texte discret>
                  {evolutionTexte(b.evolution)} · bénéfice {m(b.benefice)} · {b.nombreVentes}{' '}
                  vente(s)
                </Texte>
                <Texte discret>
                  Stock {m(b.stockVente)} · crédits {m(b.creditsDu)}
                  {b.creditsEnRetard ? ` (${b.creditsEnRetard} en retard)` : ''} · dépenses{' '}
                  {m(b.depenses)}
                </Texte>
                <Text
                  style={{
                    color: syncAncienne(b.derniereSync) ? c.alerte : c.texteDiscret,
                    fontSize: 13,
                  }}
                >
                  {b.derniereSync
                    ? `Dernière synchronisation : ${formaterDate(b.derniereSync, fuseau, true)}`
                    : 'Aucune synchronisation reçue'}
                </Text>
              </View>
            ))}
          </Carte>

          {tableau.series.length ? (
            <Carte titre="Évolution du chiffre d’affaires" icone="stats-chart">
              {tableau.series.map((s) => (
                <View key={s.cle} style={styles.ligne}>
                  <View style={{ flex: 1 }}>
                    <Texte>{s.libelle}</Texte>
                  </View>
                  <Texte gras>{m(Object.values(s.valeurs).reduce((t, v) => t + v, 0))}</Texte>
                </View>
              ))}
            </Carte>
          ) : null}

          {trocs ? (
            <Carte titre="Trocs" icone="swap-horizontal">
              <Texte>
                {trocs.total.repris} repris pour {m(trocs.total.valeurReprise)} ·{' '}
                {trocs.total.aReparer} à réparer · {trocs.total.repares} réparé(s) ·{' '}
                {trocs.total.enVente} en vente
              </Texte>
              <Texte gras>
                {trocs.total.revendus} revendu(s) pour {m(trocs.total.ventesRevendus)} · marge{' '}
                {m(trocs.total.marge)}
              </Texte>
            </Carte>
          ) : null}

          <Carte titre="Exports" icone="download">
            <Bouton
              titre="Imprimer (PDF)"
              icone="print-outline"
              variante="secondaire"
              onPress={() => void lancer(() => imprimerHtml(pdf()))}
            />
            {partagePdfDisponible ? (
              <Bouton
                titre="Partager le PDF"
                icone="share-outline"
                variante="secondaire"
                onPress={() => void lancer(() => partagerPdf(pdf(), 'Tableau de bord'))}
              />
            ) : null}
            <Bouton
              titre="Classeur Excel"
              icone="grid-outline"
              variante="secondaire"
              onPress={() =>
                void lancer(() =>
                  exporterExcel(api, `/tableau/excel?${requete()}`, 'tableau-de-bord.xlsx'),
                )
              }
            />
          </Carte>

          {archives ? (
            <Carte titre="Rapports planifiés" icone="time">
              <Texte discret>Produits automatiquement chaque semaine et chaque mois.</Texte>
              {archives.length === 0 ? <Texte discret>Aucun rapport pour l’instant.</Texte> : null}
              {archives.map((a) => (
                <View key={a.id} style={styles.ligne}>
                  <View style={{ flex: 1 }}>
                    <Texte>
                      {a.frequence === 'SEMAINE' ? 'Semaine' : 'Mois'} du{' '}
                      {formaterDate(a.du, fuseau)} au{' '}
                      {formaterDate(new Date(new Date(a.au).getTime() - 1).toISOString(), fuseau)}
                    </Texte>
                  </View>
                  <Bouton
                    titre="Excel"
                    variante="secondaire"
                    onPress={() =>
                      void lancer(() =>
                        exporterExcel(
                          api,
                          `/tableau/archives/${a.id}`,
                          `rapport-${a.du.slice(0, 10)}.xlsx`,
                        ),
                      )
                    }
                  />
                </View>
              ))}
            </Carte>
          ) : null}
        </>
      ) : null}
    </Ecran>
  );
}

const styles = StyleSheet.create({
  grille: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  boutique: { gap: 4, paddingVertical: 6 },
  ligne: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  nom: { fontSize: 16, fontWeight: '700', flex: 1 },
  barre: { height: 8, borderRadius: 4, overflow: 'hidden' },
  remplissage: { height: 8, borderRadius: 4 },
});
