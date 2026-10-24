# Recette finale, sécurité et performance

Compte rendu de l'étape 21. Tout ce qui suit est vérifié par des tests automatiques,
rejoués à chaque modification (`pnpm test`, `pnpm --filter @gestvente/api test:e2e`, CI).

## Critères de recette du cahier des charges

| #   | Critère                                                                             | Test de bout en bout                  |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Une vente faite hors ligne apparaît sur le serveur après reconnexion, sans doublon. | `api/test/recette.e2e-spec.ts`        |
| 2   | Un IMEI vendu ne peut plus être vendu, même depuis une autre boutique.              | `api/test/recette.e2e-spec.ts`        |
| 3   | Un troc réduit le prix du neuf et ajoute l'ancien appareil au stock occasion.       | `api/test/recette-finale.e2e-spec.ts` |
| 4   | Une tranche encaissée met à jour le solde et produit un reçu.                       | `api/test/recette-finale.e2e-spec.ts` |
| 5   | Un client en retard reçoit un rappel automatique.                                   | `api/test/recette-finale.e2e-spec.ts` |
| 6   | Un transfert entre boutiques déplace le stock une fois la réception confirmée.      | `api/test/recette-finale.e2e-spec.ts` |
| 7   | Le propriétaire voit les chiffres de toutes ses boutiques sur un seul écran.        | `api/test/recette-finale.e2e-spec.ts` |

Restauration après la perte d'un appareil : le vendeur se connecte sur un nouvel appareil,
qui reçoit du serveur ventes, crédits, encaissements, trocs et stock ; l'ancien appareil,
déconnecté à distance, est refusé (même fichier). Côté serveur, la sauvegarde chiffrée
quotidienne est décrite dans `docs/DEPLOIEMENT.md`.

## Sécurité

| Exigence                      | Mise en œuvre                                                                                                                           | Vérification                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Toute route exige un jeton    | `JwtAuthGuard` global, exceptions `@Public()` justifiées                                                                                | `securite.e2e-spec.ts` (inventaire OpenAPI)                                                              |
| Toute route déclare ses rôles | `@Roles(...)` sur chaque méthode ou contrôleur ; espace concepteur : `ConcepteurGuard`                                                  | `roles.e2e-spec.ts` (inspection de chaque route)                                                         |
| Cloisonnement des boutiques   | `boutiqueIds` relus à chaque requête, `BoutiqueGuard`, synchronisation filtrée                                                          | `isolation.e2e-spec.ts` (toutes les routes qui prennent une boutique)                                    |
| Cloisonnement des commerces   | filtre `commerceId` partout                                                                                                             | `cloisonnement.e2e-spec.ts` (toutes les routes à identifiant, avec les identifiants d'un autre commerce) |
| Limitation de débit           | connexion (IP, identifiant), PIN, concepteur ; `DebitGuard` : 600 requêtes/min par IP, 60/min sur le lien public des factures (Redis)   | `debit.guard.spec.ts`, `auth.e2e-spec.ts`                                                                |
| En-têtes de sécurité          | helmet (CSP stricte, `frame-ancestors 'none'`), Caddy (HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`)                        | `securite.e2e-spec.ts`                                                                                   |
| Chiffrement                   | HTTPS (Caddy, Let's Encrypt) ; base locale SQLCipher sur Android et iOS (clé dans le coffre de l'appareil)                              | configuration `app.json` (`useSQLCipher`)                                                                |
| Journal d'audit               | remises, prix, annulations, archivages (produit, client, fournisseur), sorties de stock, connexions, crédits, trocs, transferts, équipe | écran Journal, tests de chaque module                                                                    |
| Déconnexion à distance        | appareil ou employé ; désactivation d'un employé                                                                                        | `auth.e2e-spec.ts`, `equipe.e2e-spec.ts`                                                                 |

Limite connue : sur le site installé dans un navigateur (ordinateur), la base locale
n'est pas chiffrée par SQLCipher (stockage du navigateur). L'ordinateur de la boutique doit
avoir une session protégée ; la déconnexion efface la base locale.

## Performance

Volume du cahier des charges : 10 000 produits et 20 000 IMEI par boutique.

| Mesure                                                                        | Résultat (machine de développement)          | Exigence              |
| ----------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| Recherche par nom, code-barres, IMEI sur l'appareil                           | ≈ 15 ms (test : < 100 ms)                    | < 1 s                 |
| Vente sur l'appareil (numéro, contrôles, stock, lignes), 5 000 ventes passées | ≈ 50 ms (test : < 300 ms)                    | < 2 s                 |
| Vente synchronisée (serveur)                                                  | ≈ 0,3 s                                      | —                     |
| Premier remplissage d'un appareil (instantané)                                | ≈ 1,5 s ; 10,7 Mo, 1,6 Mo compressés (Caddy) | une fois par appareil |
| Tableau de bord consolidé                                                     | ≈ 0,3 s                                      | —                     |

Un téléphone d'entrée de gamme est 5 à 10 fois plus lent que la machine de mesure : les
seuils des tests gardent cette marge (`app/src/lib/performance.test.ts`,
`api/test/performance.e2e-spec.ts`). Corrections apportées : le numéro de facture ne relit
plus toutes les ventes à chaque encaissement (compteur local), index locaux sur le numéro de
facture et les ventes d'un téléphone, index serveur pour les agrégats du tableau de bord.
