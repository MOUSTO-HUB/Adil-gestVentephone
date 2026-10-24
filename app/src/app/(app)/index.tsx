import { formaterMontant, LIBELLES_ROLES, peutGererSessions, jourLocal } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Bouton, Ecran, Grille, Indicateur, Message, Section, Tuile } from '@/components/ui';
import { produitsSousSeuil } from '@/lib/achats';
import { caisseOuverte } from '@/lib/caisse-session';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

/**
 * Accueil : chiffres du jour, la vente en premier, puis les écrans regroupés par
 * thème (vente et caisse, stock, clients, gestion, réglages).
 */
export default function Accueil() {
  const c = useCouleurs();
  const { profil, boutique, choisirBoutique, verrouiller, deconnexion, rafraichirProfil } =
    useSession();
  const { etat, conflits } = useSync();
  const boutiqueId = boutique?.id ?? '';
  const gestion = !!profil && peutGererSessions(profil.role);

  useEffect(() => {
    rafraichirProfil().catch(() => undefined);
  }, [rafraichirProfil]);

  const jour = useLecture(
    async (base) => {
      const minuit = new Date();
      minuit.setHours(0, 0, 0, 0);
      const ventes = await base.premier<{ nombre: number; total: number | null }>(
        `SELECT COUNT(*) AS nombre, SUM(total) AS total FROM vente
          WHERE boutiqueId = ? AND statut = 'VALIDEE' AND dateVente >= ?
            AND (? = 1 OR vendeurId = ?)`,
        [boutiqueId, minuit.toISOString(), gestion ? 1 : 0, profil?.id ?? ''],
      );
      const telephones = await base.premier<{ nombre: number }>(
        "SELECT COUNT(*) AS nombre FROM article WHERE boutiqueId = ? AND statut = 'EN_STOCK'",
        [boutiqueId],
      );
      const aValider = await base.premier<{ nombre: number }>(
        "SELECT COUNT(*) AS nombre FROM caisse WHERE boutiqueId = ? AND statut = 'CLOTUREE'",
        [boutiqueId],
      );
      return {
        ventes: ventes?.nombre ?? 0,
        total: ventes?.total ?? 0,
        telephones: telephones?.nombre ?? 0,
        caisse: profil ? await caisseOuverte(base, boutiqueId, profil.id) : null,
        aValider: gestion ? (aValider?.nombre ?? 0) : 0,
      };
    },
    [boutiqueId, profil?.id, gestion],
  );
  const sousSeuil = useLecture((base) => produitsSousSeuil(base, boutiqueId), [boutiqueId]);
  // Crédits avec une tranche échue non payée (badge de la tuile).
  const creditsEnRetard = useLecture(
    async (base) =>
      (
        await base.premier<{ nombre: number }>(
          `SELECT COUNT(DISTINCT cr.id) AS nombre FROM credit cr
             JOIN echeance e ON e.creditId = cr.id
            WHERE cr.boutiqueId = ? AND cr.statut = 'EN_COURS'
              AND e.dateEcheance < ? AND e.montantPaye < e.montant + e.penalite`,
          [boutiqueId, jourLocal(new Date(), profil?.commerce.fuseau ?? 'Africa/Conakry')],
        )
      )?.nombre ?? 0,
    [boutiqueId],
  );

  if (!profil || !boutique) return null;
  const monnaie = profil.commerce.monnaie;
  const aller = (chemin: Parameters<typeof router.push>[0]) => () => router.push(chemin);

  const seDeconnecter = async () => {
    if (
      etat.enAttente > 0 &&
      !(await confirmer(
        `${etat.enAttente} opération(s) ne sont pas encore envoyées au serveur et seront perdues. Se déconnecter quand même ?`,
        'Se déconnecter',
      ))
    ) {
      return;
    }
    await deconnexion();
  };

  const prenom = profil.nom.split(' ')[0];
  const aVerifier = etat.refusees + (gestion ? conflits : etat.enConflit);
  const aTraiter = (jour?.aValider ?? 0) + aVerifier;

  return (
    <Ecran
      titre={`Bonjour ${prenom}`}
      sousTitre={`${boutique.nom} · ${LIBELLES_ROLES[profil.role]}`}
      retour={false}
      enHaut
    >
      <Grille>
        <Indicateur
          libelle={gestion ? 'Ventes du jour' : 'Mes ventes du jour'}
          valeur={formaterMontant(jour?.total ?? 0, monnaie)}
          detail={`${jour?.ventes ?? 0} vente(s)`}
          icone="trending-up"
          couleur={c.succes}
          large
        />
        <Indicateur
          libelle="Ma caisse"
          valeur={jour?.caisse ? 'Ouverte' : 'Fermée'}
          detail={
            jour?.caisse
              ? `depuis ${new Date(jour.caisse.ouverteLe).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'à ouvrir avant de vendre'
          }
          icone="cash"
          couleur={jour?.caisse ? c.succes : c.alerte}
        />
        <Indicateur
          libelle="Téléphones"
          valeur={String(jour?.telephones ?? 0)}
          detail={sousSeuil?.length ? `${sousSeuil.length} en stock bas` : 'en stock'}
          icone="phone-portrait"
          couleur={sousSeuil?.length ? c.alerte : c.primaire}
        />
        {gestion ? (
          <Indicateur
            libelle="À traiter"
            valeur={String(aTraiter)}
            detail={`${jour?.aValider ?? 0} caisse(s), ${aVerifier} conflit(s)`}
            icone="checkmark-done"
            couleur={aTraiter ? c.danger : c.succes}
          />
        ) : null}
      </Grille>

      <Bouton titre="Nouvelle vente" icone="cart" variante="accent" onPress={aller('/vente')} />

      {sousSeuil?.length ? (
        <Message
          type="info"
          texte={`Stock bas : ${sousSeuil
            .slice(0, 4)
            .map((p) => `${p.nom} (${p.quantite})`)
            .join(', ')}${sousSeuil.length > 4 ? '…' : ''}`}
        />
      ) : null}

      <Section titre="Ventes et caisse" />
      <Grille>
        <Tuile titre="Ventes" icone="receipt" onPress={aller('/ventes')} />
        <Tuile
          titre="Caisse"
          icone="cash"
          couleur={c.succes}
          onPress={aller('/caisse')}
          badge={jour?.aValider}
        />
        <Tuile
          titre="Retours et échanges"
          icone="swap-horizontal"
          couleur={c.alerte}
          onPress={aller('/retours')}
        />
        <Tuile titre="Dépenses" icone="wallet" couleur={c.danger} onPress={aller('/depenses')} />
        <Tuile
          titre="Crédits"
          icone="calendar"
          couleur={c.primaire}
          onPress={aller('/credits')}
          badge={creditsEnRetard}
        />
      </Grille>

      <Section titre="Troc" />
      <Grille>
        <Tuile
          titre="Trocs"
          icone="swap-horizontal-outline"
          couleur={c.accent}
          onPress={aller('/trocs')}
        />
        <Tuile
          titre="IMEI signalés"
          icone="warning"
          couleur={c.danger}
          onPress={aller('/imei-signales')}
        />
        {profil.role === 'PROPRIETAIRE' ? (
          <Tuile titre="Grille de reprise" icone="pricetags" onPress={aller('/grille-reprise')} />
        ) : null}
      </Grille>

      <Section titre="Stock" />
      <Grille>
        <Tuile titre="Stock" icone="cube" onPress={aller('/stock')} badge={sousSeuil?.length} />
        <Tuile titre="Fiche IMEI" icone="barcode" onPress={aller('/imei')} />
        <Tuile
          titre="Garantie"
          icone="shield-checkmark"
          couleur={c.succes}
          onPress={aller('/garantie')}
        />
        {gestion ? (
          <>
            <Tuile titre="Achats" icone="bag-add" couleur={c.accent} onPress={aller('/achats')} />
            <Tuile titre="Inventaire" icone="clipboard" onPress={aller('/inventaire')} />
            <Tuile titre="Fournisseurs" icone="business" onPress={aller('/fournisseurs')} />
          </>
        ) : null}
      </Grille>

      <Section titre="Clients" />
      <Grille>
        <Tuile titre="Clients" icone="people" onPress={aller('/clients')} />
      </Grille>

      {gestion ? (
        <>
          <Section titre="Gestion" />
          <Grille>
            <Tuile
              titre="Rapports"
              icone="bar-chart"
              couleur={c.succes}
              onPress={aller('/rapports')}
            />
            <Tuile titre="Journal d’audit" icone="document-text" onPress={aller('/journal')} />
            <Tuile
              titre="Messages aux clients"
              icone="chatbubbles"
              couleur={c.accent}
              onPress={aller('/messages')}
            />
            <Tuile
              titre="Appareils connectés"
              icone="phone-portrait"
              onPress={aller('/appareils')}
            />
            <Tuile titre="Équipe" icone="people-circle" onPress={aller('/equipe')} />
            {profil.role === 'PROPRIETAIRE' ? (
              <Tuile
                titre="Boutiques"
                icone="storefront"
                couleur={c.accent}
                onPress={aller('/boutiques')}
              />
            ) : null}
          </Grille>
        </>
      ) : null}

      <Section titre="Réglages" />
      <Grille>
        <Tuile titre="Imprimante" icone="print" onPress={aller('/imprimante')} />
        <Tuile
          titre="Synchronisation"
          icone="cloud-upload"
          onPress={aller('/synchronisation')}
          badge={etat.enAttente + aVerifier || undefined}
        />
        {profil.boutiques.length > 1 ? (
          <Tuile
            titre="Changer de boutique"
            icone="storefront"
            onPress={() => void choisirBoutique(null)}
          />
        ) : null}
      </Grille>

      <Bouton titre="Verrouiller" icone="lock-closed" variante="secondaire" onPress={verrouiller} />
      <Bouton
        titre="Se déconnecter"
        icone="log-out"
        variante="danger"
        onPress={() => void seDeconnecter()}
      />
    </Ecran>
  );
}
