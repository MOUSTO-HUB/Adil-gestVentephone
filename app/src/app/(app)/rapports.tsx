import {
  type Chiffres,
  formaterMontant,
  libellePeriode,
  LIBELLES_CATEGORIES_DEPENSE,
  LIBELLES_MOYENS,
  MOYENS_REMBOURSEMENT,
  type Montants,
  type RapportStock,
  type Regroupement,
  rapportHtml,
  type SectionRapport,
} from '@gestvente/commun';
import { useEffect, useState } from 'react';
import { Choix } from '@/components/choix';
import { Bouton, Carte, Ecran, Message, Texte } from '@/components/ui';
import { ErreurReseau, messageErreur } from '@/lib/api';
import { FUSEAU_PAR_DEFAUT } from '@/lib/documents';
import { exporterExcel } from '@/lib/export-excel';
import { imprimerHtml, partagePdfDisponible, partagerPdf } from '@/lib/impression';
import {
  bornes,
  type CodePeriode,
  PERIODES,
  rapportStockLocal,
  rapportVentesLocal,
} from '@/lib/rapports';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';

type Type = 'ventes' | 'stock' | 'caisse';
type Ligne = Chiffres & { cle: string; libelle?: string };
interface Ventes {
  total: Chiffres;
  parPeriode: Ligne[];
  parVendeur: Ligne[];
  parProduit: Ligne[];
}
interface Caisse {
  encaisse: Montants;
  rembourse: Montants;
  solde: Montants;
  caisses: {
    id: string;
    vendeur: string;
    statut: string;
    ouverteLe: string;
    attendu: number | null;
    compte: number | null;
    ecart: number | null;
  }[];
  depenses: {
    total: number;
    horsCaisse: number;
    parCategorie: { categorie: string; libelle: string; montant: number }[];
  };
}
type Resultat =
  | { type: 'ventes'; donnees: Ventes }
  | { type: 'stock'; donnees: RapportStock & { jours: number } }
  | { type: 'caisse'; donnees: Caisse };

const TYPES = [
  { id: 'ventes', nom: 'Ventes et bénéfice' },
  { id: 'stock', nom: 'Stock' },
  { id: 'caisse', nom: 'Caisse et dépenses' },
];
const REGROUPEMENTS = [
  { id: 'jour', nom: 'Par jour' },
  { id: 'semaine', nom: 'Par semaine' },
  { id: 'mois', nom: 'Par mois' },
];
const JOURS = [
  { id: '30', nom: '30 jours' },
  { id: '60', nom: '60 jours' },
  { id: '90', nom: '90 jours' },
];

/**
 * Rapports de la boutique (gestion) : calculés par le serveur ; hors ligne, ventes et
 * stock sont recalculés sur les données de l'appareil. Export PDF et Excel.
 */
export default function Rapports() {
  const { profil, boutique, api } = useSession();
  const { base, version } = useSync();
  const monnaie = profil?.commerce.monnaie;
  const fuseau = profil?.commerce.fuseau ?? FUSEAU_PAR_DEFAUT;
  const [type, setType] = useState<Type>('ventes');
  const [periode, setPeriode] = useState<CodePeriode>('jour');
  const [regroupement, setRegroupement] = useState<Regroupement>('jour');
  const [jours, setJours] = useState('30');
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [export_, setExport] = useState<'pdf' | 'excel' | null>(null);
  const boutiqueId = boutique?.id ?? '';
  const { du, au } = bornes(periode);
  // Chaque rapport ne reçoit que ses paramètres (le serveur refuse les autres).
  const parametres: Record<Type, Record<string, string>> = {
    ventes: { boutiqueId, du: du.toISOString(), au: au.toISOString(), regroupement },
    stock: { boutiqueId, jours },
    caisse: { boutiqueId, du: du.toISOString(), au: au.toISOString() },
  };
  const requete = new URLSearchParams(parametres[type]).toString();
  // L'export Excel accepte la période et le nombre de jours pour les trois rapports.
  const requeteExcel = new URLSearchParams({
    type,
    boutiqueId,
    du: du.toISOString(),
    au: au.toISOString(),
    regroupement,
    jours,
  }).toString();

  useEffect(() => {
    if (!boutiqueId || !base) return;
    let actif = true;
    const charger = async (): Promise<Resultat> => {
      try {
        const donnees = await api.requete<unknown>(`/rapports/${type}?${requete}`);
        if (actif) setHorsLigne(false);
        return { type, donnees } as Resultat;
      } catch (e) {
        if (!(e instanceof ErreurReseau) || type === 'caisse') throw e;
        if (actif) setHorsLigne(true);
        return type === 'ventes'
          ? {
              type,
              donnees: await rapportVentesLocal(base, boutiqueId, { du, au }, regroupement, fuseau),
            }
          : { type, donnees: await rapportStockLocal(base, boutiqueId, Number(jours)) };
      }
    };
    charger()
      .then((r) => {
        if (!actif) return;
        setResultat(r);
        setMessage(null);
      })
      .catch((e: unknown) => {
        if (!actif) return;
        setResultat(null);
        setMessage(
          e instanceof ErreurReseau
            ? 'Rapport de caisse disponible en ligne seulement.'
            : messageErreur(e),
        );
      });
    return () => {
      actif = false;
    };
    // Bornes recalculées depuis `periode` : la requête suffit comme dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, base, boutiqueId, type, requete, version]);

  if (!profil || !boutique) {
    return (
      <Ecran titre="Rapports" enHaut>
        {null}
      </Ecran>
    );
  }

  const m = (v: number) => formaterMontant(v, monnaie);
  const nomPeriode = PERIODES.find((p) => p.id === periode)?.nom ?? '';
  const sousTitre = `${boutique.nom} · ${type === 'stock' ? 'aujourd’hui' : nomPeriode}`;
  const colonnesChiffres = ['CA net', 'Bénéfice brut', 'Quantité'];
  const chiffres = (c: Chiffres) => [m(c.chiffreAffaires), m(c.benefice), String(c.quantite)];

  const sections = (): SectionRapport[] => {
    if (!resultat) return [];
    if (resultat.type === 'ventes') {
      const r = resultat.donnees;
      return [
        {
          titre: 'Totaux',
          colonnes: ['Ventes', 'Retours', 'CA net', 'Coût', 'Bénéfice brut', 'Nombre'],
          lignes: [
            [
              m(r.total.ventes),
              m(r.total.retours),
              m(r.total.chiffreAffaires),
              m(r.total.cout),
              m(r.total.benefice),
              String(r.total.nombreVentes),
            ],
          ],
          aDroite: [0, 1, 2, 3, 4, 5],
        },
        {
          titre: 'Par période',
          colonnes: ['Période', ...colonnesChiffres],
          lignes: r.parPeriode.map((p) => [libellePeriode(p.cle), ...chiffres(p)]),
          aDroite: [1, 2, 3],
        },
        {
          titre: 'Par vendeur',
          colonnes: ['Vendeur', ...colonnesChiffres],
          lignes: r.parVendeur.map((p) => [p.libelle ?? '—', ...chiffres(p)]),
          aDroite: [1, 2, 3],
        },
        {
          titre: 'Meilleures ventes',
          colonnes: ['Produit', ...colonnesChiffres],
          lignes: r.parProduit.map((p) => [p.libelle ?? '—', ...chiffres(p)]),
          aDroite: [1, 2, 3],
        },
      ];
    }
    if (resultat.type === 'stock') {
      const r = resultat.donnees;
      return [
        {
          titre: 'Valeur du stock',
          colonnes: ['Quantité', 'Au prix d’achat', 'Au prix de vente'],
          lignes: [[String(r.quantite), m(r.valeurAchat), m(r.valeurVente)]],
          aDroite: [0, 1, 2],
        },
        {
          titre: `Sans vente depuis ${r.jours} jours`,
          colonnes: ['Produit', 'Quantité', 'Valeur d’achat', 'Dernière vente'],
          lignes: r.sansVente.map((p) => [
            p.nom,
            String(p.quantite),
            m(p.valeurAchat),
            p.derniereVente ? new Date(p.derniereVente).toLocaleDateString('fr-FR') : 'jamais',
          ]),
          aDroite: [1, 2],
        },
        {
          titre: 'Stock par produit',
          colonnes: ['Produit', 'Quantité', 'Valeur d’achat', 'Valeur de vente'],
          lignes: r.produits.map((p) => [
            p.nom,
            String(p.quantite),
            m(p.valeurAchat),
            m(p.valeurVente),
          ]),
          aDroite: [1, 2, 3],
        },
      ];
    }
    const r = resultat.donnees;
    return [
      {
        titre: 'Moyens de paiement',
        colonnes: ['Moyen', 'Encaissé', 'Remboursé', 'Solde'],
        lignes: MOYENS_REMBOURSEMENT.map((k) => [
          LIBELLES_MOYENS[k],
          m(r.encaisse[k]),
          m(r.rembourse[k]),
          m(r.solde[k]),
        ]),
        aDroite: [1, 2, 3],
      },
      {
        titre: 'Caisses',
        colonnes: ['Vendeur', 'Ouverte le', 'Attendu', 'Compté', 'Écart'],
        lignes: r.caisses.map((c) => [
          c.vendeur,
          new Date(c.ouverteLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
          c.attendu === null ? '—' : m(c.attendu),
          c.compte === null ? 'ouverte' : m(c.compte),
          c.ecart === null ? '—' : m(c.ecart),
        ]),
        aDroite: [2, 3, 4],
      },
      {
        titre: `Dépenses : ${m(r.depenses.total)} (dont hors caisse ${m(r.depenses.horsCaisse)})`,
        colonnes: ['Catégorie', 'Montant'],
        lignes: r.depenses.parCategorie.map((c) => [
          LIBELLES_CATEGORIES_DEPENSE[c.categorie as keyof typeof LIBELLES_CATEGORIES_DEPENSE] ??
            c.libelle,
          m(c.montant),
        ]),
        aDroite: [1],
      },
    ];
  };

  const titre = TYPES.find((t) => t.id === type)?.nom ?? 'Rapport';
  const pdf = async () => {
    setExport('pdf');
    try {
      const html = rapportHtml(titre, `${profil.commerce.nom} · ${sousTitre}`, sections());
      if (partagePdfDisponible) await partagerPdf(html, titre);
      else await imprimerHtml(html);
    } catch (e) {
      setMessage(messageErreur(e));
    } finally {
      setExport(null);
    }
  };
  const excel = async () => {
    setExport('excel');
    try {
      await exporterExcel(api, `/rapports/excel?${requeteExcel}`, `rapport-${type}.xlsx`);
    } catch (e) {
      setMessage(
        e instanceof ErreurReseau ? 'L’export Excel demande une connexion.' : messageErreur(e),
      );
    } finally {
      setExport(null);
    }
  };

  return (
    <Ecran titre="Rapports" sousTitre={sousTitre} enHaut>
      <Choix
        libelle="Rapport"
        options={TYPES}
        valeurs={[type]}
        surChoix={([t]) => t && setType(t as Type)}
      />
      {type !== 'stock' ? (
        <Choix
          libelle="Période"
          options={PERIODES}
          valeurs={[periode]}
          surChoix={([p]) => p && setPeriode(p as CodePeriode)}
        />
      ) : (
        <Choix
          libelle="Sans vente depuis"
          options={JOURS}
          valeurs={[jours]}
          surChoix={([j]) => j && setJours(j)}
        />
      )}
      {type === 'ventes' ? (
        <Choix
          libelle="Regrouper"
          options={REGROUPEMENTS}
          valeurs={[regroupement]}
          surChoix={([r]) => r && setRegroupement(r as Regroupement)}
        />
      ) : null}
      {horsLigne ? (
        <Message
          type="info"
          texte="Hors ligne : calcul sur les données de cet appareil (60 derniers jours)."
        />
      ) : null}
      <Message texte={message} />

      {resultat?.type === 'ventes' ? (
        <>
          <Carte>
            <Texte gras>Chiffre d’affaires net : {m(resultat.donnees.total.chiffreAffaires)}</Texte>
            <Texte gras>Bénéfice brut : {m(resultat.donnees.total.benefice)}</Texte>
            <Texte discret>
              {resultat.donnees.total.nombreVentes} vente(s) · ventes{' '}
              {m(resultat.donnees.total.ventes)} · retours {m(resultat.donnees.total.retours)} ·
              coût {m(resultat.donnees.total.cout)}
            </Texte>
          </Carte>
          <Liste
            titre="Par période"
            lignes={resultat.donnees.parPeriode.map((p) => ({
              ...p,
              libelle: libellePeriode(p.cle),
            }))}
            m={m}
          />
          {!horsLigne ? (
            <Liste titre="Par vendeur" lignes={resultat.donnees.parVendeur} m={m} />
          ) : null}
          <Liste
            titre="Meilleures ventes"
            lignes={resultat.donnees.parProduit.slice(0, 15)}
            m={m}
          />
        </>
      ) : null}

      {resultat?.type === 'stock' ? (
        <>
          <Carte>
            <Texte gras>{resultat.donnees.quantite} article(s) en stock</Texte>
            <Texte>Au prix d’achat : {m(resultat.donnees.valeurAchat)}</Texte>
            <Texte>Au prix de vente : {m(resultat.donnees.valeurVente)}</Texte>
          </Carte>
          <Carte>
            <Texte gras>
              Sans vente depuis {resultat.donnees.jours} jours ({resultat.donnees.sansVente.length})
            </Texte>
            {resultat.donnees.sansVente.slice(0, 30).map((p) => (
              <Texte key={p.produitId} discret>
                {p.nom} · {p.quantite} · {m(p.valeurAchat)} ·{' '}
                {p.derniereVente
                  ? `dernière vente le ${new Date(p.derniereVente).toLocaleDateString('fr-FR')}`
                  : 'jamais vendu'}
              </Texte>
            ))}
          </Carte>
        </>
      ) : null}

      {resultat?.type === 'caisse' ? (
        <>
          <Carte>
            <Texte gras>Encaissements</Texte>
            {MOYENS_REMBOURSEMENT.map((k) => (
              <Texte key={k} discret>
                {LIBELLES_MOYENS[k]} : encaissé {m(resultat.donnees.encaisse[k])} · remboursé{' '}
                {m(resultat.donnees.rembourse[k])}
              </Texte>
            ))}
          </Carte>
          <Carte>
            <Texte gras>Caisses ({resultat.donnees.caisses.length})</Texte>
            {resultat.donnees.caisses.map((c) => (
              <Texte key={c.id} discret>
                {new Date(c.ouverteLe).toLocaleDateString('fr-FR')} · {c.vendeur} ·{' '}
                {c.ecart === null ? 'non clôturée' : `écart ${m(c.ecart)}`}
              </Texte>
            ))}
          </Carte>
          <Carte>
            <Texte gras>Dépenses : {m(resultat.donnees.depenses.total)}</Texte>
            {resultat.donnees.depenses.parCategorie.map((c) => (
              <Texte key={c.categorie} discret>
                {c.libelle} : {m(c.montant)}
              </Texte>
            ))}
          </Carte>
        </>
      ) : null}

      {resultat ? (
        <>
          <Bouton
            titre={partagePdfDisponible ? 'Partager en PDF' : 'Imprimer ou enregistrer en PDF'}
            variante="secondaire"
            chargement={export_ === 'pdf'}
            onPress={() => void pdf()}
          />
          <Bouton
            titre="Exporter en Excel"
            variante="secondaire"
            chargement={export_ === 'excel'}
            desactive={horsLigne}
            onPress={() => void excel()}
          />
        </>
      ) : null}
    </Ecran>
  );
}

function Liste({ titre, lignes, m }: { titre: string; lignes: Ligne[]; m: (v: number) => string }) {
  return (
    <Carte>
      <Texte gras>{titre}</Texte>
      {lignes.length === 0 ? <Texte discret>Aucune vente.</Texte> : null}
      {lignes.map((l) => (
        <Texte key={l.cle} discret>
          {l.libelle ?? l.cle} : CA {m(l.chiffreAffaires)} · bénéfice {m(l.benefice)} · {l.quantite}{' '}
          art.
        </Texte>
      ))}
    </Carte>
  );
}
