import { type Changement, idPrixBoutiqueProvisoire } from '@gestvente/commun';
import {
  enregistrerCategorie,
  enregistrerMarque,
  enregistrerModele,
  enregistrerPrixBoutique,
  enregistrerProduit,
} from '../../catalogue/catalogue.ecritures.js';
import { Role } from '../../generated/prisma/enums.js';
import type { Tx } from '../journal.service.js';
import {
  versCategorie,
  versCompatibilite,
  versMarque,
  versModele,
  versPrixBoutique,
  versProduit,
} from '../serialisation.js';
import type { Gestionnaire } from './gestionnaire.js';

/** Le catalogue et les prix ne sont modifiés que par le propriétaire et les gérants. */
const GESTION = [Role.PROPRIETAIRE, Role.GERANT];

async function etatProduit(tx: Tx, id: string): Promise<Changement[]> {
  const produit = await tx.produit.findUnique({ where: { id } });
  if (!produit) return [{ seq: 0, entite: 'produit', id, donnees: null }];
  const compatibilites = await tx.compatibilite.findMany({ where: { accessoireId: id } });
  return [
    { seq: 0, entite: 'produit', id, donnees: versProduit(produit) },
    ...compatibilites.map((c) => ({
      seq: 0,
      entite: 'compatibilite' as const,
      id: versCompatibilite(c).id,
      donnees: versCompatibilite(c),
    })),
  ];
}

export const marqueEnregistrer: Gestionnaire<'MARQUE_ENREGISTRER'> = {
  type: 'MARQUE_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerMarque(ctx, contenu),
  async corrections(tx, _op, contenu) {
    const marque = await tx.marque.findUnique({ where: { id: contenu.id } });
    return [{ seq: 0, entite: 'marque', id: contenu.id, donnees: marque && versMarque(marque) }];
  },
};

export const modeleEnregistrer: Gestionnaire<'MODELE_ENREGISTRER'> = {
  type: 'MODELE_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerModele(ctx, contenu),
  async corrections(tx, _op, contenu) {
    const modele = await tx.modele.findUnique({ where: { id: contenu.id } });
    return [{ seq: 0, entite: 'modele', id: contenu.id, donnees: modele && versModele(modele) }];
  },
};

export const categorieEnregistrer: Gestionnaire<'CATEGORIE_ENREGISTRER'> = {
  type: 'CATEGORIE_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerCategorie(ctx, contenu),
  async corrections(tx, _op, contenu) {
    const categorie = await tx.categorie.findUnique({ where: { id: contenu.id } });
    return [
      {
        seq: 0,
        entite: 'categorie',
        id: contenu.id,
        donnees: categorie && versCategorie(categorie),
      },
    ];
  },
};

export const produitEnregistrer: Gestionnaire<'PRODUIT_ENREGISTRER'> = {
  type: 'PRODUIT_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerProduit(ctx, contenu),
  corrections: (tx, _op, contenu) => etatProduit(tx, contenu.id),
};

export const prixBoutiqueEnregistrer: Gestionnaire<'PRIX_BOUTIQUE_ENREGISTRER'> = {
  type: 'PRIX_BOUTIQUE_ENREGISTRER',
  roles: GESTION,
  appliquer: (ctx, contenu) => enregistrerPrixBoutique(ctx, ctx.operation.boutiqueId, contenu),
  async corrections(tx, operation, contenu) {
    const ligne = await tx.prixBoutique.findUnique({
      where: {
        produitId_boutiqueId: { produitId: contenu.produitId, boutiqueId: operation.boutiqueId },
      },
    });
    // Sans prix propres sur le serveur, l'appareil efface sa ligne provisoire.
    return ligne
      ? [{ seq: 0, entite: 'prixBoutique', id: ligne.id, donnees: versPrixBoutique(ligne) }]
      : [
          {
            seq: 0,
            entite: 'prixBoutique',
            id: idPrixBoutiqueProvisoire(contenu.produitId, operation.boutiqueId),
            donnees: null,
          },
        ];
  },
};
