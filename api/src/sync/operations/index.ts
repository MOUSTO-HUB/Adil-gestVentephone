import type { TypeOperation } from '@gestvente/commun';
import {
  achatAnnuler,
  achatEnregistrer,
  achatPayer,
  achatRecevoir,
  inventaireValider,
  stockSeuil,
} from './achats.operations.js';
import {
  categorieEnregistrer,
  marqueEnregistrer,
  modeleEnregistrer,
  prixBoutiqueEnregistrer,
  produitEnregistrer,
} from './catalogue.operations.js';
import { clientEnregistrer, fournisseurEnregistrer } from './clients.operations.js';
import type { Gestionnaire } from './gestionnaire.js';
import { articleSortir, stockAjuster } from './stock.operations.js';
import { venteAnnuler, venteEnregistrer } from './ventes.operations.js';

/** Un gestionnaire par type d'opération (chaque fonctionnalité ajoute les siens). */
export const GESTIONNAIRES: { [T in TypeOperation]: Gestionnaire<T> } = {
  STOCK_AJUSTER: stockAjuster,
  ARTICLE_SORTIR: articleSortir,
  MARQUE_ENREGISTRER: marqueEnregistrer,
  MODELE_ENREGISTRER: modeleEnregistrer,
  CATEGORIE_ENREGISTRER: categorieEnregistrer,
  PRODUIT_ENREGISTRER: produitEnregistrer,
  PRIX_BOUTIQUE_ENREGISTRER: prixBoutiqueEnregistrer,
  CLIENT_ENREGISTRER: clientEnregistrer,
  FOURNISSEUR_ENREGISTRER: fournisseurEnregistrer,
  ACHAT_ENREGISTRER: achatEnregistrer,
  ACHAT_RECEVOIR: achatRecevoir,
  ACHAT_PAYER: achatPayer,
  ACHAT_ANNULER: achatAnnuler,
  STOCK_SEUIL: stockSeuil,
  INVENTAIRE_VALIDER: inventaireValider,
  VENTE_ENREGISTRER: venteEnregistrer,
  VENTE_ANNULER: venteAnnuler,
};
