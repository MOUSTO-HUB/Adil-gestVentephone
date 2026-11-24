import { avertissementAbonnement, formaterMontant, LIBELLES_ROLES } from '@gestvente/commun';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Bouton, Ecran, GrandeTuile, Grille, Indicateur, Message, Section } from '@/components/ui';
import { AlertesSync } from '@/components/indicateur-sync';
import { caisseOuverte } from '@/lib/caisse-session';
import { useCompteurs } from '@/lib/compteurs';
import { useSession } from '@/lib/session';
import { useLecture, useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

/**
 * Accueil : chiffres du jour, puis 8 grandes tuiles pour les gestes de tous les jours
 * (Vendre en premier). Toutes les autres options sont dans l'écran Menu (onglet du bas).
 */
export default function Accueil() {
  const c = useCouleurs();
  const { profil, boutique, rafraichirProfil } = useSession();
  const { etat } = useSync();
  const n = useCompteurs();
  const boutiqueId = boutique?.id ?? '';
  const gestion = n.gestion;
  const [ouvertLe] = useState(() => new Date());

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
        // Stock des téléphones, avec ou sans IMEI enregistré.
        `SELECT COALESCE(SUM(MAX(s.quantite, 0)), 0) AS nombre FROM stock s
           JOIN produit p ON p.id = s.produitId
          WHERE s.boutiqueId = ? AND p.type = 'TELEPHONE'`,
        [boutiqueId],
      );
      return {
        ventes: ventes?.nombre ?? 0,
        total: ventes?.total ?? 0,
        telephones: telephones?.nombre ?? 0,
        caisse: profil ? await caisseOuverte(base, boutiqueId, profil.id) : null,
      };
    },
    [boutiqueId, profil?.id, gestion],
  );
  if (!profil || !boutique) return null;
  const monnaie = profil.commerce.monnaie;
  const aller = (chemin: Parameters<typeof router.push>[0]) => () => router.push(chemin);

  const prenom = profil.nom.split(' ')[0];
  // Seul le propriétaire est prévenu de l'échéance de l'abonnement (essai compris).
  const abonnement = profil.commerce.abonnement;
  const avertissement =
    profil.role === 'PROPRIETAIRE' && abonnement?.jusquAu
      ? avertissementAbonnement(new Date(abonnement.jusquAu), abonnement.etat === 'ESSAI', ouvertLe)
      : null;
  const aTraiter = n.caissesAValider + n.aVerifier;

  return (
    <Ecran
      titre={`Bonjour ${prenom}`}
      sousTitre={`${boutique.nom} · ${LIBELLES_ROLES[profil.role]}`}
      retour={false}
      enHaut
      large
    >
      {/* Refus du serveur (commerce suspendu, abonnement expiré…) : rien ne part, tout est gardé. */}
      <AlertesSync />
      {avertissement && !etat.erreur ? (
        <Message type={avertissement.niveau} texte={avertissement.texte} />
      ) : null}
      <Grille>
        <Indicateur
          libelle={gestion ? 'Ventes du jour' : 'Mes ventes du jour'}
          valeur={formaterMontant(jour?.total ?? 0, monnaie)}
          detail={`${jour?.ventes ?? 0} vente(s)`}
          icone="trending-up"
          couleur={c.succes}
          large
          compact
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
          compact
        />
        <Indicateur
          libelle="Téléphones"
          valeur={String(jour?.telephones ?? 0)}
          detail={n.stockBas ? `${n.stockBas} en stock bas` : 'en stock'}
          icone="phone-portrait"
          couleur={n.stockBas ? c.alerte : c.primaire}
          compact
        />
        {gestion && aTraiter ? (
          <Indicateur
            compact
            libelle="À traiter"
            valeur={String(aTraiter)}
            detail={`${n.caissesAValider} caisse(s), ${n.aVerifier} conflit(s)`}
            icone="checkmark-done"
            couleur={aTraiter ? c.danger : c.succes}
          />
        ) : null}
      </Grille>

      {n.sousSeuil?.length ? (
        <Message
          type="info"
          texte={`Stock bas : ${n.sousSeuil
            .slice(0, 4)
            .map((p) => `${p.nom} (${p.quantite})`)
            .join(', ')}${n.sousSeuil.length > 4 ? '…' : ''}`}
        />
      ) : null}

      <Section titre="Que voulez-vous faire ?" icone="hand-left" />
      <Grille>
        <GrandeTuile
          titre="Vendre"
          icone="cart"
          couleur={c.accent}
          plein
          onPress={aller('/vente')}
        />
        <GrandeTuile
          titre="Caisse"
          icone="cash"
          couleur={c.succes}
          onPress={aller('/caisse')}
          badge={n.caissesAValider}
        />
        <GrandeTuile
          titre="Ventes"
          icone="receipt"
          couleur={c.primaire}
          onPress={aller('/ventes')}
        />
        <GrandeTuile
          titre="Crédits"
          icone="calendar"
          couleur={c.primaire}
          onPress={aller('/credits')}
          badge={n.creditsEnRetard}
        />
        <GrandeTuile
          titre="Stock"
          icone="cube"
          couleur={c.primaire}
          onPress={aller('/stock')}
          badge={n.stockBas}
        />
        <GrandeTuile
          titre="Clients"
          icone="people"
          couleur={c.primaire}
          onPress={aller('/clients')}
        />
        <GrandeTuile
          titre="Retours"
          icone="return-down-back"
          couleur={c.alerte}
          onPress={aller('/retours')}
        />
        <GrandeTuile
          titre="Dépenses"
          icone="wallet"
          couleur={c.danger}
          onPress={aller('/depenses')}
        />
      </Grille>

      <Bouton
        titre="Toutes les options"
        icone="grid"
        variante="secondaire"
        onPress={aller('/menu')}
      />
    </Ecran>
  );
}
