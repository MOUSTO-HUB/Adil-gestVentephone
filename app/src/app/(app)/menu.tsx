import { LIBELLES_ROLES } from '@gestvente/commun';
import { router } from 'expo-router';
import { Bouton, Ecran, GrandeTuile, Grille, Section } from '@/components/ui';
import { useCompteurs } from '@/lib/compteurs';
import { confirmer } from '@/lib/confirmer';
import { useSession } from '@/lib/session';
import { useSync } from '@/lib/sync/contexte';
import { useCouleurs } from '@/lib/theme';

/** Menu : toutes les options de l'espace commerçant, rangées par thème avec un pictogramme. */
export default function Menu() {
  const c = useCouleurs();
  const { profil, boutique, choisirBoutique, verrouiller, deconnexion } = useSession();
  const { etat } = useSync();
  const n = useCompteurs();
  if (!profil || !boutique) return null;
  const proprietaire = profil.role === 'PROPRIETAIRE';
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

  return (
    <Ecran
      titre="Menu"
      sousTitre={`${boutique.nom} · ${LIBELLES_ROLES[profil.role]}`}
      retour={false}
      enHaut
      large
    >
      <Section titre="Vendre et encaisser" icone="cash" />
      <Grille>
        <GrandeTuile
          petite
          titre="Vendre"
          icone="cart"
          couleur={c.accent}
          onPress={aller('/vente')}
        />
        <GrandeTuile petite titre="Ventes" icone="receipt" onPress={aller('/ventes')} />
        <GrandeTuile
          petite
          titre="Caisse"
          icone="cash"
          couleur={c.succes}
          onPress={aller('/caisse')}
          badge={n.caissesAValider}
        />
        <GrandeTuile
          petite
          titre="Crédits"
          icone="calendar"
          onPress={aller('/credits')}
          badge={n.creditsEnRetard}
        />
        <GrandeTuile
          petite
          titre="Retours"
          icone="return-down-back"
          couleur={c.alerte}
          onPress={aller('/retours')}
        />
        <GrandeTuile
          petite
          titre="Dépenses"
          icone="wallet"
          couleur={c.danger}
          onPress={aller('/depenses')}
        />
      </Grille>

      <Section titre="Troc (reprise de téléphone)" icone="swap-horizontal" />
      <Grille>
        <GrandeTuile
          petite
          titre="Trocs"
          icone="swap-horizontal"
          couleur={c.accent}
          onPress={aller('/trocs')}
        />
        <GrandeTuile
          petite
          titre="Volés (IMEI)"
          icone="warning"
          couleur={c.danger}
          onPress={aller('/imei-signales')}
        />
        {proprietaire ? (
          <GrandeTuile
            petite
            titre="Prix reprise"
            icone="pricetags"
            onPress={aller('/grille-reprise')}
          />
        ) : null}
      </Grille>

      <Section titre="Stock et marchandise" icone="cube" />
      <Grille>
        <GrandeTuile
          petite
          titre="Stock"
          icone="cube"
          onPress={aller('/stock')}
          badge={n.stockBas}
        />
        <GrandeTuile petite titre="Chercher IMEI" icone="barcode" onPress={aller('/imei')} />
        <GrandeTuile
          petite
          titre="Garantie"
          icone="shield-checkmark"
          couleur={c.succes}
          onPress={aller('/garantie')}
        />
        <GrandeTuile
          petite
          titre="Transferts"
          icone="git-compare"
          onPress={aller('/transferts')}
          badge={n.transferts}
        />
        {n.gestion ? (
          <>
            <GrandeTuile
              petite
              titre="Bons d’achat"
              icone="bag-add"
              couleur={c.accent}
              onPress={aller('/achats')}
            />
            <GrandeTuile
              petite
              titre="Inventaire"
              icone="clipboard"
              onPress={aller('/inventaire')}
            />
            <GrandeTuile
              petite
              titre="Fournisseurs"
              icone="business"
              onPress={aller('/fournisseurs')}
            />
          </>
        ) : null}
      </Grille>

      <Section titre="Clients" icone="people" />
      <Grille>
        <GrandeTuile petite titre="Clients" icone="people" onPress={aller('/clients')} />
        {n.gestion ? (
          <GrandeTuile
            petite
            titre="Messages"
            icone="chatbubbles"
            couleur={c.accent}
            onPress={aller('/messages')}
          />
        ) : null}
        {n.gestion ? (
          <GrandeTuile petite titre="Rappels" icone="alarm" onPress={aller('/rappels')} />
        ) : null}
      </Grille>

      {n.gestion ? (
        <>
          <Section titre="Gestion du commerce" icone="briefcase" />
          <Grille>
            <GrandeTuile
              petite
              titre="Tableau de bord"
              icone="speedometer"
              onPress={aller('/tableau')}
            />
            <GrandeTuile
              petite
              titre="Rapports"
              icone="bar-chart"
              couleur={c.succes}
              onPress={aller('/rapports')}
            />
            <GrandeTuile petite titre="Équipe" icone="people-circle" onPress={aller('/equipe')} />
            {proprietaire ? (
              <GrandeTuile
                petite
                titre="Boutiques"
                icone="storefront"
                couleur={c.accent}
                onPress={aller('/boutiques')}
              />
            ) : null}
            <GrandeTuile
              petite
              titre="Appareils"
              icone="phone-portrait"
              onPress={aller('/appareils')}
            />
            <GrandeTuile petite titre="Journal" icone="document-text" onPress={aller('/journal')} />
          </Grille>
        </>
      ) : null}

      <Section titre="Réglages et aide" icone="settings" />
      <Grille>
        <GrandeTuile
          petite
          titre="Aide"
          icone="help-buoy"
          couleur={c.accent}
          onPress={aller('/aide')}
        />
        <GrandeTuile petite titre="Imprimante" icone="print" onPress={aller('/imprimante')} />
        <GrandeTuile
          petite
          titre="Synchro"
          icone="cloud-upload"
          onPress={aller('/synchronisation')}
          badge={n.synchronisation || undefined}
        />
        {profil.boutiques.length > 1 ? (
          <GrandeTuile
            petite
            titre="Changer boutique"
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
