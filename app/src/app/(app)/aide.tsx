import { peutGererSessions } from '@gestvente/commun';
import { StyleSheet, View } from 'react-native';
import { Carte, Ecran, Message, Texte } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useCouleurs } from '@/lib/theme';

type Fiche = [question: string, reponse: string];

/** Aide-mémoire du vendeur (docs/guide/aide-memoire.md, version courte). */
const VENDEUR: Fiche[] = [
  ['Commencer la journée', 'Caisse → fond de caisse → Ouvrir la caisse.'],
  [
    'Vendre',
    'Nouvelle vente → chercher (nom, code, IMEI) ou pastilles marque / modèle → IMEI du téléphone → paiement → Encaisser.',
  ],
  ['Remise trop forte', 'Le gérant valide avec son identifiant et son code PIN.'],
  [
    'Faire un troc',
    'Client (pièce d’identité) → Troc → modèle, IMEI (*#06#), état → valeur → à revendre ou à réparer → encaisser la différence.',
  ],
  [
    'Vendre à crédit',
    'Client (fiche complète, plafond) → Vendre à crédit → apport, tranches → Encaisser l’apport → imprimer le contrat.',
  ],
  ['Encaisser une tranche', 'Crédits → client → montant → moyen → Encaisser → reçu.'],
  ['Réimprimer un reçu', 'Ventes → la vente → Reçu, facture, WhatsApp…'],
  ['Finir la journée', 'Caisse → Clôture → compter chaque moyen → commentaire si écart.'],
  ['Plus d’Internet', 'Continuez : tout part au retour du réseau (bandeau du haut).'],
  ['Opération en rouge', 'Synchronisation → raison du refus ; prévenez le gérant.'],
];

const GERANT: Fiche[] = [
  ['Recevoir une commande', 'Achats → bon d’achat → réceptionner (IMEI en rafale, quantités).'],
  ['Inventaire', 'Inventaire → compter ou scanner → motif → Valider l’inventaire.'],
  ['Retour ou échange', 'Retours et échanges → facture, IMEI ou client → articles, état, devenir.'],
  ['Transfert', 'Transferts → demander, préparer (scan) ou réceptionner (scan, écarts).'],
  ['Crédits en retard', 'Crédits → En retard → fiche → Relancer maintenant.'],
  ['Valider les caisses', 'Caisse → caisses clôturées → Valider (écart expliqué).'],
];

const PROPRIETAIRE: Fiche[] = [
  ['Nouvelle boutique', 'Boutiques → Nouvelle boutique (préfixe des factures définitif).'],
  ['Nouvel employé', 'Équipe → Nouvel employé → rôle, boutiques → mot de passe provisoire.'],
  ['Prix d’une boutique', 'Stock → produit → Prix propres à la boutique.'],
  ['Vue d’ensemble', 'Tableau de bord → période, boutiques, exports PDF et Excel.'],
  ['Appareil perdu', 'Appareils connectés → Déconnecter ; Équipe → Nouveau mot de passe.'],
];

/** Aide rapide selon le rôle ; le guide complet et la formation sont dans docs/guide. */
export default function Aide() {
  const c = useCouleurs();
  const { profil } = useSession();
  if (!profil)
    return (
      <Ecran titre="Aide" enHaut>
        {null}
      </Ecran>
    );
  const gestion = peutGererSessions(profil.role);

  const liste = (titre: string, fiches: Fiche[]) => (
    <Carte titre={titre} icone="help-circle">
      {fiches.map(([question, reponse]) => (
        <View key={question} style={[styles.fiche, { borderColor: c.bordure }]}>
          <Texte gras>{question}</Texte>
          <Texte>{reponse}</Texte>
        </View>
      ))}
    </Carte>
  );

  return (
    <Ecran titre="Aide" sousTitre="Je veux… je fais…" enHaut>
      {liste('Vendre au quotidien', VENDEUR)}
      {gestion ? liste('Gérer la boutique', GERANT) : null}
      {profil.role === 'PROPRIETAIRE' ? liste('Diriger le commerce', PROPRIETAIRE) : null}
      <Message
        type="info"
        texte="Le guide complet illustré (une fiche par tâche) et le support de formation sont fournis par le propriétaire en PDF."
      />
      <Texte discret>
        Jamais : partager son mot de passe ou son code PIN, reprendre un téléphone dont l’IMEI est
        signalé, se déconnecter avec des opérations en attente.
      </Texte>
    </Ecran>
  );
}

const styles = StyleSheet.create({
  fiche: { borderTopWidth: 1, paddingTop: 8, gap: 2 },
});
