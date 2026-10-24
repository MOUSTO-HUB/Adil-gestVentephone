# Prompts pour construire Adil-gestVentephone avec un assistant IA

Donnez ces prompts dans l'ordre à un assistant de code (Claude Code par exemple), un par session de travail ; validez et testez chaque étape avant de passer à la suivante. Cochez l'étape dans le tableau une fois terminée.

Le prompt 0 (contexte du projet) est déjà en place dans [`CLAUDE.md`](../CLAUDE.md) à la racine du dépôt : l'assistant le lit automatiquement.

Référence : [Cahier des charges](CAHIER_DES_CHARGES.md).

## Étapes de développement

| #   | Phase               | Étape                                         | Fait |
| --- | ------------------- | --------------------------------------------- | ---- |
| M   | Préparation         | Maquettes des écrans (optionnel)              | ☐    |
| 1   | 1 · Socle           | Initialisation du monorepo                    | ☑    |
| 2   | 1 · Socle           | Schéma de base de données                     | ☑    |
| 3   | 1 · Socle           | Authentification, rôles et appareils          | ☑    |
| 4   | 1 · Socle           | Base locale et moteur de synchronisation      | ☑    |
| 5   | 1 · Socle           | Catalogue produits                            | ☑    |
| 6   | 1 · Socle           | Clients et fournisseurs                       | ☑    |
| 7   | 1 · Socle           | Achats, stock, IMEI et inventaire             | ☑    |
| 8   | 1 · Socle           | Ventes au détail et en gros                   | ☑    |
| 9   | 1 · Socle           | Factures, reçus, impression et garantie       | ☑    |
| 10  | 1 · Socle           | Retours et échanges                           | ☑    |
| 11  | 1 · Socle           | Caisse et dépenses                            | ☑    |
| 12  | 1 · Socle           | Rapports de base et journal d'audit           | ☑    |
| 13  | 1 · Socle           | Mise en production de la phase 1              | ☑    |
| 14  | 2 · Troc et crédit  | Messagerie SMS et WhatsApp                    | ☑    |
| 15  | 2 · Troc et crédit  | Troc (reprise d'appareils)                    | ☑    |
| 16  | 2 · Troc et crédit  | Vente à crédit et tranches                    | ☑    |
| 17  | 2 · Troc et crédit  | Rappels automatiques et pénalités             | ☑    |
| 18  | 3 · Multi-boutiques | Boutiques multiples, employés et prix         | ☑    |
| 19  | 3 · Multi-boutiques | Transferts entre boutiques                    | ☑    |
| 20  | 3 · Multi-boutiques | Tableau de bord consolidé et rapports avancés | ☑    |
| 21  | 3 · Multi-boutiques | Sécurité, performance et recette finale       | ☑    |
| 22  | 3 · Multi-boutiques | Documentation utilisateur et formation        | ☑    |
| 23  | Option              | Abonnement pour d'autres commerçants          | ☐    |

---

## Prompt de maquettes (optionnel, avant l'étape 1)

```text
Propose les maquettes basse fidélité des écrans d'Adil-gestVentephone, en version téléphone et en version ordinateur : écran de vente (recherche/scan, panier, paiement), fiche produit avec ses IMEI, entrée de stock depuis un bon d'achat, troc (état de l'appareil, valeur proposée), contrat de crédit et encaissement d'une tranche, ouverture/clôture de caisse, tableau de bord du propriétaire. Public : vendeurs sans formation informatique, smartphones d'entrée de gamme, connexion lente ou absente. Montre l'indicateur en ligne / hors ligne / opérations en attente, les états vides et les gros boutons.
```

## Phase 1 — Socle (une boutique, hors ligne)

### Prompt 1 — Initialisation

```text
Crée un monorepo pnpm "adil-gestventephone" avec : /api (NestJS + Prisma + PostgreSQL, modules ES, tests Vitest, routes sous le préfixe /api, documentation OpenAPI sur /api/docs), /app (Expo React Native en TypeScript avec expo-router, cible Android, iOS et web), /packages/commun (TypeScript pur : types, schémas zod et règles métier partagés par l'API et l'application). Ajoute un docker-compose avec PostgreSQL et Redis, un .env.example, Prettier commun (guillemets simples), lint (oxlint pour l'API, ESLint pour l'app), les scripts racine lint, typecheck, test, format:check, et complète le README pour tout lancer en local. Ne code aucune fonctionnalité métier.
```

### Prompt 2 — Schéma de base de données

```text
Dans /api, écris le schéma Prisma d'après la section 5.2 de docs/CAHIER_DES_CHARGES.md : Commerce, Boutique, Utilisateur, UtilisateurBoutique, Appareil, Marque, Categorie, Produit (type TELEPHONE ou ACCESSOIRE, capacité, couleur, état NEUF/OCCASION, code-barres, garantie en mois, seuil de gros), Compatibilite, prix communs (achat, détail, gros) sur le Produit et PrixBoutique pour les prix propres à une boutique, Article (un téléphone par IMEI, statut EN_STOCK, VENDU, RETOURNE, EN_TRANSFERT, A_REPARER, REBUT…), Stock (quantité d'accessoires par boutique, seuil minimum), MouvementStock, Fournisseur, Achat, LigneAchat, Client, Garant, Vente, LigneVente, Paiement (ESPECES, ORANGE_MONEY, MTN_MOMO, VIREMENT), Caisse, Depense, JournalAudit, OperationSync (UUID de l'appareil, type, statut, conflit). Prévois dès maintenant les tables des phases 2 et 3 (Troc, GrilleReprise, ImeiSignale, Credit, Echeance, Encaissement, Transfert, LigneTransfert, Inventaire, Message). Montants en entiers (Int ou BigInt), IMEI unique par commerce, commerceId partout, creeLe/modifieLe/creePar, index utiles (IMEI, code-barres, téléphone client). Génère la migration et un seed : 1 commerce, 1 boutique, 1 propriétaire, 1 gérant, 2 vendeurs, 40 produits (téléphones et accessoires), 60 IMEI, 10 clients, 3 fournisseurs.
```

### Prompt 3 — Authentification, rôles et appareils

```text
Implémente l'authentification dans /api : connexion par identifiant + mot de passe (argon2), jetons JWT d'accès (15 min) et de rafraîchissement (30 jours) liés à un Appareil enregistré. Rôles PROPRIETAIRE, GERANT, VENDEUR avec un décorateur @Roles et un garde qui vérifie que l'utilisateur est rattaché à la boutique concernée ; toutes les données filtrées par commerceId. Code PIN à 4-6 chiffres pour déverrouiller l'application sur un appareil déjà connecté, y compris hors ligne (vérifié localement, 5 essais). Le propriétaire et le gérant peuvent déconnecter à distance un appareil ou un employé. Limitation des essais de connexion (Redis), journal d'audit des connexions. Dans /app : écrans connexion, PIN, choix de la boutique, jetons dans expo-secure-store. Tests unitaires des gardes et des règles de PIN.
```

### Prompt 4 — Base locale et moteur de synchronisation

```text
Construis le hors ligne selon la section 5.1 de docs/CAHIER_DES_CHARGES.md. Dans /app : base SQLite locale (expo-sqlite, chiffrée sur mobile, WebAssembly sur le web) avec migrations versionnées ; une file sortante d'opérations (UUID généré sur l'appareil, type, contenu, statut) écrite dans la même transaction que la modification locale ; un service de synchronisation qui envoie les opérations par lots dès que le réseau revient, puis récupère les changements depuis son curseur ; un indicateur permanent (en ligne, hors ligne, synchronisation, N opérations en attente). Dans /api : POST /sync/operations (application idempotente, un UUID déjà reçu n'est jamais rejoué, réponse par opération : appliquée, rejetée, en conflit) et GET /sync/changements?curseur=. Les règles de conflit vivent dans /packages/commun et sont testées : un IMEI déjà vendu fait passer la seconde vente en conflit, signalée au gérant. Branche d'abord le catalogue et le stock ; chaque fonctionnalité suivante ajoutera ses types d'opérations. Tests : rejeu d'un lot, coupure au milieu d'un envoi, deux appareils qui vendent le même IMEI.
```

### Prompt 5 — Catalogue produits

```text
Crée le catalogue (API + écrans de l'app, synchronisé hors ligne) : marques, catégories, produits (marque, modèle, catégorie, capacité, couleur, état neuf/occasion, photo, code-barres, garantie en mois), les trois prix (achat, détail, gros) avec le seuil de quantité de gros, la compatibilité accessoire ↔ modèles. Seuls PROPRIETAIRE et GERANT modifient les prix ; chaque changement de prix va au journal d'audit. Recherche instantanée (moins d'1 s sur 10 000 articles, index SQLite) par nom, modèle, code-barres ou IMEI, et scan du code-barres à la caméra ou au lecteur USB (champ qui reçoit la saisie clavier). Photos compressées avant envoi. Import du catalogue depuis un fichier Excel avec rapport des lignes en erreur.
```

### Prompt 6 — Clients et fournisseurs

```text
Crée les fichiers clients et fournisseurs (API + app, hors ligne). Client : nom, téléphone en E.164 (indicatif +224 par défaut, paramétrable), type DETAIL ou GROSSISTE, pièce d'identité (type, numéro, photo), adresse, garant facultatif, plafond de crédit, historique (achats, crédits, trocs — vides pour l'instant). Recherche par nom ou téléphone, détection des doublons de téléphone. Fournisseur : coordonnées, historique des achats, dette envers le fournisseur. Les photos de pièces d'identité ne sont visibles que par le personnel de la boutique, jamais en cache public.
```

### Prompt 7 — Achats, stock, IMEI et inventaire

```text
Crée l'approvisionnement et le stock. Bon d'achat fournisseur : lignes (produit, quantité, prix d'achat), saisie ou scan des IMEI un par un ou en rafale (contrôle de la formule de Luhn, refus des doublons), réception totale ou partielle, montant payé et reste dû au fournisseur. Chaque entrée crée des Articles (téléphones) ou augmente le Stock (accessoires) et un MouvementStock. Stock par boutique, seuil minimum par article et alerte visible. Inventaire physique : comptage par scan, écarts calculés, ajustement avec motif obligatoire, validé par le gérant et journalisé. Fiche IMEI avec l'historique complet (achat, boutique, vente, client, retour, troc). Toutes les opérations passent par la file de synchronisation. Tests unitaires des calculs de stock et d'écarts.
```

### Prompt 8 — Ventes au détail et en gros

```text
Crée l'écran de vente, optimisé pour une vente en moins d'une minute et enregistrée en moins de 2 secondes hors ligne : recherche ou scan, panier multi-articles (choix de l'IMEI pour un téléphone, quantité pour un accessoire), proposition automatique des accessoires compatibles, client facultatif au détail. Prix de gros appliqué automatiquement au-delà du seuil de quantité ou pour un client GROSSISTE. Remise limitée selon le rôle (plafond en % paramétré par le propriétaire), au-delà validation du gérant par son PIN ; toute remise est journalisée. Paiement en espèces, Orange Money, MTN MoMo, virement ou mixte (référence de transaction saisie, pas d'intégration de paiement en V1), rendu de monnaie. La vente met à jour le stock et le statut de l'IMEI localement puis se synchronise ; un conflit d'IMEI est montré au gérant. Annulation d'une vente réservée au gérant, avec motif. Règles de prix et de remise dans /packages/commun, testées.
```

### Prompt 9 — Factures, reçus, impression et garantie

```text
Génère la facture A4 (PDF) et le reçu thermique 58 mm et 80 mm d'une vente : en-tête de la boutique, numéro de facture séquentiel par boutique (attribué hors ligne sans collision, préfixe par appareil), lignes, IMEI, remises, paiements, reste à payer, mentions de garantie (durée par produit et date de fin). Impression sur imprimante thermique Bluetooth (ESC/POS) depuis Android, impression classique depuis l'ordinateur, partage du PDF par WhatsApp ou SMS (lien ou pièce jointe). Ajoute la consultation de garantie à partir d'un IMEI : produit, date de vente, client, garantie restante.
```

### Prompt 10 — Retours et échanges

```text
Crée les retours et échanges : recherche de la vente par numéro, IMEI ou client ; conditions paramétrables (délai maximal, état de l'appareil, garantie) ; retour avec remboursement (moyen de paiement) ou avoir, ou échange contre un autre article avec paiement ou rendu de la différence. L'article revient en stock (neuf, occasion à revendre) ou part au rebut, avec motif. Réservé au gérant ou validé par son PIN, journalisé, synchronisé, visible dans l'historique de l'IMEI. Tests des calculs de différence.
```

### Prompt 11 — Caisse et dépenses

```text
Crée la caisse : ouverture journalière par vendeur avec fond de caisse, toutes les ventes, encaissements et remboursements rattachés à la session ouverte, clôture avec comptage par moyen de paiement (espèces, Orange Money, MTN MoMo, virement), écart constaté et commentaire, validation par le gérant. Saisie des dépenses de la boutique (loyer, électricité, transport, autre) avec justificatif photo, payées depuis la caisse ou non. Rapport de clôture imprimable (ticket 80 mm et PDF). Fonctionne hors ligne. Tests des calculs de caisse.
```

### Prompt 12 — Rapports de base et journal d'audit

```text
Crée les rapports de la boutique (calculés côté serveur, consultables aussi hors ligne sur les données locales du jour) : chiffre d'affaires et bénéfice brut par jour, semaine, mois, par vendeur et par produit ; meilleures ventes ; articles sans vente depuis N jours ; valeur du stock au prix d'achat et de vente ; caisse et dépenses. Export PDF et Excel. Ajoute l'écran du journal d'audit pour le propriétaire et le gérant (suppression, remise, modification de prix, annulation, ajustement de stock, connexion), filtrable par utilisateur, boutique et période.
```

### Prompt 13 — Mise en production de la phase 1

```text
Prépare la mise en service de la phase 1 : Dockerfiles, docker-compose.prod.yml (Caddy en HTTPS, API, PostgreSQL, Redis, sauvegarde quotidienne chiffrée de PostgreSQL avec rotation), guide docs/DEPLOIEMENT.md pour un VPS, CI GitHub Actions (lint, typecheck, tests, build). Application web installable (PWA : manifeste, icônes, service worker, en-têtes nécessaires à SQLite WebAssembly) pour les ordinateurs Windows et Mac. Configuration EAS (eas.json) pour Android (APK pour installation directe et AAB pour le Play Store) et iOS, et EAS Update pour les mises à jour sans réinstallation. Vérifie les critères de recette 1 et 2 du cahier des charges avec un test de bout en bout.
```

## Phase 2 — Troc et crédit

### Prompt 14 — Messagerie SMS et WhatsApp

```text
Crée un module Messages côté serveur, utilisé par tous les autres modules (jamais d'appel direct à un fournisseur depuis un module métier) : envoyer({ commerceId, clientId, type, variables, canaux }). Modèles de textes modifiables par le propriétaire, variables ({client}, {montant}, {monnaie}, {echeance}, {boutique}, {lien}), SMS limité à 160 caractères. Fournisseurs derrière des interfaces : SmsSender (fournisseur local, implémentation de test qui écrit dans les journaux) et WhatsAppSender (API WhatsApp Business Cloud, modèles approuvés). Envoi par BullMQ, 3 essais avec délai croissant, bascule WhatsApp → SMS en cas d'échec, journal de chaque envoi (statut, coût). Les envois demandés hors ligne par l'app partent quand l'opération arrive au serveur. Branche l'envoi de la facture ou du reçu d'une vente.
```

### Prompt 15 — Troc (reprise d'appareils)

```text
Crée le troc, intégré à l'écran de vente : saisie de l'appareil du client (modèle, IMEI, état de l'écran, de la batterie, du boîtier, fonctionnement, photos) et de sa pièce d'identité (fiche client obligatoire). La grille de reprise (par modèle et par état, modifiable par le propriétaire) propose une valeur ; le vendeur l'ajuste dans la limite autorisée (au-delà : PIN du gérant), ajustement journalisé. La valeur de reprise est déduite du prix du neuf, le client paie la différence comptant ou à crédit. L'appareil repris entre en stock OCCASION au statut A_REPARER ou A_REVENDRE avec son prix de revente. Liste des IMEI signalés volés ou bloqués (saisie manuelle par le commerce) : alerte bloquante à la saisie, vérifiée aussi au serveur à la synchronisation. Calcul de la reprise dans /packages/commun, testé. Critère de recette 3.
```

### Prompt 16 — Vente à crédit et tranches

```text
Crée la vente à crédit depuis l'écran de vente : fiche client complète obligatoire (pièce d'identité, adresse, garant facultatif), contrôle du plafond de crédit (encours + nouveau crédit), apport initial, nombre de tranches, fréquence hebdomadaire ou mensuelle, échéancier calculé (dernière tranche ajustée pour tomber juste), contrat imprimable et signé. Encaissement d'une tranche totale ou partielle, hors ligne, rattaché à la caisse, avec reçu indiquant le solde restant. Tableau des crédits : en cours, en retard, soldés, montant total dû par boutique ; fiche crédit avec l'historique. Règles d'échéancier et de solde dans /packages/commun, testées. Critère de recette 4.
```

### Prompt 17 — Rappels automatiques et pénalités

```text
Ajoute une tâche quotidienne (BullMQ, 9h heure de Conakry) qui envoie par le module Messages : un rappel N jours avant chaque échéance (N paramétrable), un rappel le jour de l'échéance, puis une relance en cas de retard tous les 7 jours, avec un nombre maximal de relances. Pénalité de retard activable par le propriétaire (montant fixe ou pourcentage, délai de grâce), ajoutée au solde et visible sur la fiche crédit. Bouton « relancer maintenant » pour le gérant. Prochain rappel affiché sur la fiche. Règles de calendrier et de pénalité pures, testées. Critère de recette 5.
```

## Phase 3 — Multi-boutiques

### Prompt 18 — Boutiques multiples, employés et prix

```text
Permets au propriétaire de créer autant de boutiques qu'il veut depuis son compte, de rattacher chaque employé à une ou plusieurs boutiques (changement de boutique active dans l'app) et de définir des prix communs ou propres à une boutique (le prix de la boutique remplace le prix commun). Chaque appareil ne télécharge que les données des boutiques de son utilisateur. Vérifie que gérants et vendeurs ne voient jamais une boutique à laquelle ils ne sont pas rattachés (tests de sécurité sur toutes les routes).
```

### Prompt 19 — Transferts entre boutiques

```text
Crée les transferts de stock : demande par la boutique qui reçoit (ou envoi direct par le propriétaire), préparation et envoi par scan des IMEI et des quantités (articles au statut EN_TRANSFERT, retirés du stock de départ), réception confirmée par scan à l'arrivée avec écarts signalés ; le stock d'arrivée n'augmente qu'à la confirmation. Fonctionne hors ligne des deux côtés, historique dans la fiche IMEI. Critère de recette 6.
```

### Prompt 20 — Tableau de bord consolidé et rapports avancés

```text
Crée le tableau de bord du propriétaire : ventes, bénéfice brut, stock, crédits en cours et en retard, caisses et dépenses de toutes les boutiques ou d'une seule, sur un seul écran, avec date de dernière synchronisation de chaque boutique. Rapports avancés par boutique, vendeur et produit, comparaison entre boutiques et périodes, situation des trocs (repris, réparés, revendus, marge), exports PDF et Excel planifiés. Requêtes agrégées performantes (index, vues matérialisées si besoin). Critère de recette 7.
```

### Prompt 21 — Sécurité, performance et recette finale

```text
Fais une revue complète : contrôle d'accès de chaque route (test qui inventorie toutes les routes et exige un rôle), filtrage commerceId/boutiqueId, limitation de débit, en-têtes de sécurité, chiffrement de la base locale, journal d'audit complet, restauration des données sur un nouvel appareil après perte. Mesure les performances sur un jeu de 10 000 articles et 20 000 IMEI par boutique sur un smartphone d'entrée de gamme (vente < 2 s, recherche < 1 s) et corrige les lenteurs. Rejoue tous les critères de recette du cahier des charges en tests de bout en bout.
```

### Prompt 22 — Documentation utilisateur et formation

```text
Rédige la documentation utilisateur en français, simple et illustrée, dans docs/guide/ (Markdown et PDF) : une fiche par tâche du vendeur (vendre, troc, encaisser une tranche, ouvrir et fermer la caisse, que faire hors ligne), du gérant (stock, inventaire, retours, transferts, crédits) et du propriétaire (boutiques, employés, prix, rapports, appareils perdus). Ajoute un support de formation des vendeurs d'une heure avec des exercices sur des données de démonstration.
```

## Option

### Prompt 23 — Abonnement pour d'autres commerçants

```text
À faire seulement si le propriétaire décide de proposer l'application à d'autres commerçants. Ajoute le rôle SUPER_ADMIN (concepteur, sans commerce) et un espace /plateforme : création d'un commerce et de son propriétaire, formules et paiements d'abonnement, période d'essai, suspension (plus de connexion ni de synchronisation, données conservées) et réactivation, tableau de bord. Le concepteur n'accède jamais aux données des commerces.
```
