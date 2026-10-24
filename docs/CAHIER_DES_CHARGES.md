# Cahier des charges – Gestion de vente de téléphones et accessoires

Version du 13 octobre 2026 (document d'origine : Mamadou), mise en forme pour le développement.

## 1. Contexte et objectifs

Le projet livre une application unique qui gère toute l'activité d'un commerçant de téléphones et d'accessoires, sur une ou plusieurs boutiques, même sans connexion Internet.

Aujourd'hui, ce commerce se gère souvent sur cahier ou tableur : stocks approximatifs, crédits clients difficiles à suivre, trocs mal tracés, aucune vue globale quand le commerçant a plusieurs points de vente.

Objectifs :

- Enregistrer chaque vente (détail ou gros) en moins d'une minute, avec facture ou reçu.
- Connaître le stock exact de chaque article, par boutique et en temps réel, y compris par numéro IMEI pour les téléphones.
- Gérer le troc (reprise d'un ancien téléphone contre un neuf) avec une évaluation tracée.
- Suivre les ventes à crédit et chaque remboursement par tranche, avec relance des retards.
- Permettre au propriétaire de piloter plusieurs boutiques depuis un seul compte.
- Fonctionner hors ligne, puis synchroniser automatiquement au retour de la connexion.
- Être utilisable sur téléphone comme sur ordinateur.

## 2. Périmètre et utilisateurs

Dans le périmètre : vente, stock, troc, crédit, gestion multi-boutiques.
Hors périmètre de la V1 : comptabilité complète, vente en ligne au public (site e-commerce).

Produits gérés : téléphones (neufs et d'occasion) et accessoires électroniques liés : coques anti-casse, protège-écrans, casques et écouteurs Bluetooth, chargeurs, câbles, batteries externes, etc.

| Rôle         | Qui                             | Droits                                                                                          |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| PROPRIETAIRE | Le commerçant                   | Tout voir et tout gérer sur toutes ses boutiques : stocks, prix, employés, rapports, transferts |
| GERANT       | Responsable d'un point de vente | Stock, ventes, troc et crédits de sa boutique ; ses rapports                                    |
| VENDEUR      | Vendeur / caissier              | Ventes, trocs, encaissements ; consultation du stock ; **pas** de modification des prix         |
| Client       | Acheteur au détail ou en gros   | Pas d'accès (V1) ; reçoit factures, reçus et rappels d'échéance par SMS/WhatsApp                |
| Fournisseur  | Grossiste ou importateur        | Pas d'accès ; enregistré pour les achats et réapprovisionnements                                |

Chaque action est liée à l'utilisateur qui l'a faite (traçabilité, litiges entre employés).

## 3. Exigences fonctionnelles

### 3.1 Catalogue produits

- Fiche produit : marque, modèle, catégorie, capacité, couleur, état (neuf / occasion), photo, code-barres.
- Chaque téléphone est suivi individuellement par son IMEI (ou numéro de série) ; les accessoires sont suivis en quantité.
- Trois prix par article : prix d'achat, prix de vente au détail, prix de vente en gros.
- Compatibilité accessoire ↔ modèle (cette coque va avec tel modèle), proposée automatiquement pendant une vente.

### 3.2 Stock et approvisionnement

- Stock par boutique, mis à jour automatiquement à chaque vente, troc, retour ou transfert.
- Entrées de stock depuis un bon d'achat fournisseur, avec saisie ou scan des IMEI.
- Alerte de stock minimum par article et par boutique.
- Inventaire physique : comptage, écarts, ajustement justifié.
- Historique complet d'un IMEI : achat, boutique, vente, client, retour, troc.

### 3.3 Ventes au détail et en gros

- Vente rapide par recherche ou scan, panier multi-articles, remise autorisée selon le rôle.
- Vente en gros : prix de gros appliqué automatiquement au-delà d'une quantité définie, ou pour un client classé « grossiste ».
- Paiements : espèces, mobile money (Orange Money, MTN MoMo), virement, paiement mixte.
- Impression ou envoi (WhatsApp, SMS, PDF) de la facture ou du reçu, avec mentions de garantie.
- Retours et échanges sous conditions, avec remise en stock ou mise au rebut.
- Garantie : durée par produit, consultation de la garantie à partir de l'IMEI.

### 3.4 Troc (reprise d'un ancien téléphone)

- Le vendeur saisit l'appareil du client : modèle, IMEI, état (écran, batterie, boîtier, fonctionnement), photos.
- Le système propose une valeur de reprise selon une grille modifiable par le propriétaire ; le vendeur peut l'ajuster dans une limite autorisée.
- La valeur de reprise est déduite du prix du nouvel appareil ; le client paie la différence (comptant ou à crédit).
- L'appareil repris entre en stock « occasion », statut _à réparer_ ou _à revendre_, avec son propre prix de revente.
- Pièce d'identité du client enregistrée ; un IMEI déjà connu comme volé ou bloqué est signalé.

### 3.5 Vente à crédit et remboursement par tranches

- Contrat de crédit : client, articles, apport initial, montant restant, nombre de tranches, fréquence (hebdomadaire, mensuelle), dates d'échéance.
- Fiche client obligatoire : nom, téléphone, pièce d'identité, adresse, éventuellement un garant.
- Plafond de crédit par client, fixé par le propriétaire.
- Encaissement d'une tranche (totale ou partielle) avec reçu et solde restant.
- Rappels automatiques par SMS ou WhatsApp avant chaque échéance et en cas de retard.
- Tableau des crédits : en cours, en retard, soldés ; montant total dû par boutique.
- Pénalité de retard activable ou non.

### 3.6 Gestion multi-boutiques

- Un propriétaire crée et gère autant de boutiques qu'il le souhaite depuis un seul compte.
- Prix communs ou propres à chaque boutique.
- Transferts de stock entre boutiques : demande, envoi, réception confirmée, IMEI suivis.
- Tableau de bord consolidé : ventes, stock, crédits et caisse de toutes les boutiques, ou d'une seule.
- Chaque employé est rattaché à une ou plusieurs boutiques.

### 3.7 Clients et fournisseurs

- Fichier clients : coordonnées, type (détail / grossiste), historique d'achats, crédits, trocs.
- Fichier fournisseurs : coordonnées, achats, dettes envers le fournisseur.

### 3.8 Caisse et dépenses

- Ouverture et clôture de caisse journalières par vendeur, avec écart constaté.
- Saisie des dépenses de la boutique (loyer, électricité, transport…).

### 3.9 Rapports

- Chiffre d'affaires et bénéfice brut par jour, semaine, mois, par boutique, vendeur, produit.
- Meilleures ventes, articles qui ne tournent pas, valeur du stock.
- Situation des crédits et des trocs.
- Export PDF et Excel.

## 4. Exigences non fonctionnelles

### 4.1 Hors ligne et en ligne

- Les opérations courantes (vente, troc, encaissement de tranche, consultation du stock) fonctionnent sans Internet.
- Données stockées localement sur l'appareil, synchronisées automatiquement dès le retour de la connexion.
- Indicateur visible : en ligne, hors ligne, synchronisation en cours, opérations en attente.
- Conflits : un même IMEI ne peut pas être vendu deux fois ; la première opération synchronisée l'emporte, l'autre est signalée au gérant.
- Les fonctions qui exigent le réseau (SMS, WhatsApp, tableau consolidé à jour) sont mises en file d'attente.

### 4.2 Multi-plateforme

- Une seule application : Android, iPhone, tablette et ordinateur (Windows, Mac, navigateur web).
- Interface adaptée à la taille de l'écran ; tactile sur mobile, clavier et lecteur code-barres sur ordinateur.
- Compatible avec des smartphones d'entrée de gamme et des connexions lentes.
- Impression sur imprimante thermique Bluetooth (reçus 58/80 mm) et imprimante classique (factures A4).
- Français en V1, interface prête pour d'autres langues.
- Monnaie : franc guinéen (GNF) par défaut, paramétrable. Montants entiers.

### 4.3 Sécurité

- Connexion par identifiant et mot de passe, ou code PIN sur un appareil déjà enregistré ; droits selon le rôle.
- Données chiffrées sur l'appareil et pendant la synchronisation (HTTPS).
- Journal des opérations sensibles : suppression, remise, modification de prix, annulation.
- Sauvegarde automatique quotidienne sur le serveur ; restauration si un appareil est perdu.
- Déconnexion à distance d'un appareil ou d'un employé.

### 4.4 Performance et qualité

- Enregistrement d'une vente en moins de 2 secondes, même hors ligne.
- Recherche d'un produit ou d'un IMEI en moins d'1 seconde.
- Plusieurs milliers d'articles et d'IMEI par boutique sans ralentissement.
- Interface simple, utilisable après une courte prise en main par un vendeur sans formation informatique.

## 5. Architecture technique retenue

Le document d'origine suggérait Flutter et une API Node.js ou Laravel. La stack retenue est **TypeScript de bout en bout**, déjà maîtrisée par l'équipe :

| Brique          | Choix                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------- |
| Monorepo        | pnpm workspaces : `/api`, `/app`, `/packages/commun`                                        |
| Serveur         | NestJS + Prisma + PostgreSQL, API REST sous `/api`, documentation OpenAPI                   |
| Files d'attente | Redis + BullMQ (SMS, WhatsApp, rappels, rapports)                                           |
| Application     | Expo (React Native) : Android, iPhone, tablette, et web installable (PWA) pour Windows/Mac  |
| Base locale     | SQLite sur l'appareil (`expo-sqlite`, version WebAssembly sur le web)                       |
| Code partagé    | `/packages/commun` : types, schémas de validation, règles métier pures (prix, troc, crédit) |
| Messagerie      | Fournisseur SMS local + WhatsApp Business (API Cloud), derrière des interfaces              |
| Mises à jour    | EAS Update (mises à jour sans réinstallation) ; le web se met à jour seul                   |
| Production      | Docker Compose (Caddy, API, PostgreSQL, Redis, sauvegarde chiffrée) sur un VPS              |

### 5.1 Principes de synchronisation hors ligne

- Chaque appareil possède sa base SQLite : catalogue, prix, stock de ses boutiques, clients, crédits en cours.
- Toute opération locale (vente, troc, tranche, mouvement de stock…) reçoit un identifiant UUID généré sur l'appareil et est écrite dans une **file sortante** (outbox) dans la même transaction.
- **Montée** : l'appareil envoie ses opérations par lots ; le serveur les applique de façon idempotente (un UUID déjà reçu n'est jamais rejoué).
- **Descente** : l'appareil demande les changements depuis son dernier curseur (catalogue, prix, transferts, stock des autres appareils).
- Le serveur fait foi pour l'unicité des IMEI : si un IMEI déjà vendu arrive dans une seconde vente, l'opération est enregistrée en **conflit**, signalée au gérant, et l'appareil est corrigé à la descente suivante.
- Les envois réseau (SMS, WhatsApp) sont créés par le serveur à la réception de l'opération, jamais par l'appareil.

### 5.2 Organisation des données (indicatif)

Un **Commerce** (le compte du propriétaire) possède des **Boutiques**, des **Utilisateurs** rattachés à une ou plusieurs boutiques, un **Catalogue** (Marque, Categorie, Produit, Compatibilite), des **Prix** (communs ou par boutique), des **Articles** suivis par IMEI et des **Stocks** en quantité, des **MouvementsStock**, des **Fournisseurs**, **Achats** et **LignesAchat**, des **Clients** (et **Garants**), des **Ventes**, **LignesVente** et **Paiements**, des **Retours**, des **Trocs** et la **GrilleReprise**, des **Credits**, **Echeances** et **Encaissements**, des **Caisses** (sessions) et **Depenses**, des **Transferts**, des **Inventaires**, des **Messages** (SMS/WhatsApp), le **JournalAudit**, les **Appareils** enregistrés et les **Conflits** de synchronisation.

Chaque table porte `commerceId` (et `boutiqueId` si utile) : l'application peut ainsi accueillir plusieurs commerçants si le propriétaire décide de la proposer en abonnement (question ouverte).

## 6. Phases, livrables et recette

| Phase              | Contenu                                                                           | Livrable                          |
| ------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| 1. Socle           | Catalogue, stock et IMEI, ventes détail et gros, caisse, hors ligne, une boutique | Application installable + serveur |
| 2. Troc et crédit  | Reprise d'appareils, contrats de crédit, tranches, rappels SMS/WhatsApp           | Mise à jour de l'application      |
| 3. Multi-boutiques | Boutiques multiples, transferts, tableau consolidé, rapports avancés              | Version complète                  |

Chaque phase est utilisable en boutique avant de passer à la suivante. Les étapes détaillées et les prompts de développement sont dans [PROMPTS.md](PROMPTS.md).

Livrables : code source, application mobile et ordinateur, serveur déployé, documentation utilisateur en français, formation des vendeurs, garantie de correction des anomalies après livraison.

### Critères de recette

- [x] Une vente faite hors ligne apparaît sur le serveur après reconnexion, sans doublon.
- [x] Un IMEI vendu ne peut plus être vendu, même depuis une autre boutique.
- [x] Un troc réduit le prix du neuf et ajoute l'ancien appareil au stock occasion.
- [x] Une tranche encaissée met à jour le solde et produit un reçu.
- [x] Un client en retard reçoit un rappel automatique.
- [x] Un transfert entre boutiques déplace le stock une fois la réception confirmée.
- [x] Le propriétaire voit les chiffres de toutes ses boutiques sur un seul écran.

### Questions ouvertes

- Budget et date de mise en service souhaités ?
- Nombre de boutiques et d'employés au démarrage ?
- Faut-il des factures conformes à une norme fiscale particulière ?
- Le propriétaire veut-il vendre l'application à d'autres commerçants (abonnement) ou l'utiliser seul ?
