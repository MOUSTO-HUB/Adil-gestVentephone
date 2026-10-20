# Projet Adil-gestVentephone

Application de gestion de vente de téléphones et d'accessoires : catalogue, stock par IMEI, ventes au détail et en gros, troc, crédit par tranches, caisse, multi-boutiques. Fonctionne hors ligne et se synchronise au retour du réseau. Une seule application pour téléphone, tablette et ordinateur.

Spécifications : `docs/CAHIER_DES_CHARGES.md` · Étapes et prompts de développement : `docs/PROMPTS.md`.

## Stack

- Monorepo pnpm
- Serveur : NestJS + Prisma + PostgreSQL (dossier `/api`), routes sous `/api`, OpenAPI
- Application : Expo React Native + expo-router (dossier `/app`) pour Android, iOS et web installable (PWA)
- Base locale : SQLite (`expo-sqlite`) avec file sortante d'opérations et synchronisation
- Code partagé : `/packages/commun` (types, schémas zod, règles métier pures)
- Files d'envoi : Redis + BullMQ (SMS, WhatsApp, rappels)

## Base de données

- Prisma 7 : schéma `api/prisma/schema.prisma`, config `api/prisma.config.ts`, client généré dans `api/src/generated/prisma` (non versionné, `pnpm --filter @gestvente/api db:generate`), importé depuis `../generated/prisma/client.js` ; connexion via `PrismaService`. Modifier le schéma puis `pnpm db:migrate` ; ne jamais éditer une migration déjà poussée.
- Identifiants UUID texte (générables sur l'appareil hors ligne) ; `commerceId`, `creeLe`, `modifieLe`, `creeParId` sur chaque table.
- Prix communs sur `Produit`, prix propres à une boutique dans `PrixBoutique`. Téléphones = `Article` (IMEI unique par commerce) ; `Stock` tient la quantité par boutique (téléphones compris) ; chaque variation crée un `MouvementStock`.
- Docker : PostgreSQL sur le port 5434, Redis sur 6380. Seed : `pnpm db:seed` (comptes proprietaire, gerant, vendeur1, vendeur2 ; mot de passe `SEED_MOT_DE_PASSE`, PIN 2580).

## Catalogue

- Règles et schémas zod dans `packages/commun/src/catalogue.ts` (produit, prix de boutique, nom proposé, texte de recherche). Écritures serveur dans `api/src/catalogue/catalogue.ecritures.ts`, communes aux opérations des appareils (`MARQUE_/MODELE_/CATEGORIE_/PRODUIT_/PRIX_BOUTIQUE_ENREGISTRER`) et à l'import Excel (`import.service.ts`, simulation puis import) ; changement de prix ⇒ `PRIX_MODIFIE` au journal d'audit avec avant/après.
- Photos : `StockageService` (dossier `STOCKAGE_DIR/photos`, nom aléatoire, format vérifié aux premiers octets), envoyées compressées par l'app (`app/src/lib/photo.ts`), servies publiquement par `GET /api/photos/:nom` (images sans donnée personnelle, en cache).
- App : recherche locale `rechercherProduits` / `trouverParCode` (`app/src/lib/catalogue.ts`, colonne `recherche` normalisée), scan caméra (`components/scanner.tsx`, téléphone) ou lecteur USB (le code tapé puis Entrée dans le champ de recherche ouvre la fiche).

## Clients et fournisseurs

- Règles dans `packages/commun/src/clients.ts` et `telephone.ts` (`normaliserTelephone` : E.164, indicatif du commerce ajouté). Tout le personnel enregistre des clients, mais `erreurDroitsClient` : plafond de crédit fixé par le propriétaire seul (changement audité `PLAFOND_CREDIT_MODIFIE`), classement grossiste par propriétaire ou gérant. Un garant par client, synchronisé à part (`garant`).
- Fournisseurs : propriétaire et gérants (jamais envoyés aux vendeurs) ; `dette` = bons d'achat non payés, recalculée à chaque écriture du fournisseur (les achats de l'étape 7 devront journaliser le fournisseur).
- Pièce d'identité : fichier dans `STOCKAGE_DIR/pieces`, servi par `GET /api/clients/:id/piece` au personnel connecté, `Cache-Control: no-store`, chaque consultation auditée ; l'app l'affiche depuis la mémoire (`lireImagePrivee`), jamais en cache. Historique du client et achats du fournisseur : en ligne.
- Doublons de téléphone signalés à la saisie (non bloquants). Toute migration locale efface le curseur : l'appareil reprend un instantané complet (les nouvelles tables se remplissent).

## Achats, stock et inventaire

- Règles dans `packages/commun/src/achats.ts` (total, statut après réception, `controlerImeis` : Luhn, doublons, déjà connus ; `erreurReception`, `erreurPaiementAchat`) et `inventaire.ts` (`ecartQuantite`, `ecartsTelephones`).
- Opérations (propriétaire et gérants) : `ACHAT_ENREGISTRER` (brouillon modifiable tant que rien n'est reçu ; numéro donné par l'appareil `PREFIXE-AAMMJJ-XXXX`), `ACHAT_RECEVOIR` (identifiants des téléphones donnés par l'appareil ; un IMEI déjà connu ⇒ CONFLIT de toute la réception), `ACHAT_PAYER`, `ACHAT_ANNULER`, `STOCK_SEUIL`, `INVENTAIRE_VALIDER` (le stock suit le comptage ; téléphones non scannés sortis du stock). Écritures serveur dans `api/src/achats/achats.ecritures.ts` ; chaque entrée crée un `MouvementStock` ; dette du fournisseur journalisée avec le bon.
- Bons d'achat synchronisés (`achat`, `ligneAchat`, jamais aux vendeurs) pour réceptionner hors ligne ; comptage d'inventaire en cours gardé dans `meta` de la base locale.
- Fiche IMEI : `GET /api/articles/imei/:imei` (achat, ventes, retours, troc, mouvements ; fournisseur et prix d'achat réservés à la gestion). Saisie des IMEI en rafale : `components/saisie-imei.tsx`.

## Ventes

- Règles dans `packages/commun/src/ventes.ts` : `tarifApplicable` (gros dès le seuil du produit ou client grossiste), `plafondRemise` par rôle (`remiseMaxVendeur`, `remiseMaxGerant`, 100 % propriétaire), `erreurRemise`, `controlerPaiements` (référence obligatoire pour Orange Money, MTN MoMo, virement ; monnaie rendue seulement sur les espèces), `finGarantie`, `numeroFacture` (`PREFIXE-APPAREIL6-000001`, compteur de l'appareil dans `meta`).
- Opérations : `VENTE_ENREGISTRER` (tous les rôles ; écrite d'abord sur l'appareil) et `VENTE_ANNULER` (gestion ; refusée si retour ou crédit). Écritures serveur dans `api/src/ventes/ventes.ecritures.ts` : le serveur recontrôle tarif, remise et IMEI (déjà vendu ⇒ CONFLIT) ; écart avec ses prix journalisé `ECART_PRIX`.
- Remise au-delà du plafond : un gérant valide en personne par son PIN (`POST /api/ventes/autorisations-remise`, en ligne) ; le jeton signé est joint à la vente et vérifié par rapport à sa date.
- Prix d'achat des lignes masqué aux vendeurs ; l'instantané ne contient que les ventes des 60 derniers jours.

## Retours et échanges

- Règles dans `packages/commun/src/retours.ts` : `erreurConditionsRetour` (délai `Commerce.delaiRetourJours` ; appareil endommagé par le client refusé ; au-delà du délai, seul un appareil en panne sous garantie s'échange), `valeurRetour` (prix payé, remise de la vente au prorata, arrondi inférieur), `bilanRetour` (remboursement, avoir, ou échange : `reprise`, `aPayer`, `aRendre`), `erreurDestination` (neuf, occasion avec `prixRevente` pour un téléphone, rebut).
- Opération `RETOUR_ENREGISTRER` (écritures `api/src/retours/retours.ecritures.ts`) : gérant ou propriétaire ; un vendeur joint le jeton de `POST /api/ventes/autorisations-retour` (PIN du gérant, valable pour cette vente). L'échange crée une nouvelle vente par `enregistrerVente(ctx, vente, reprise)` (`Vente.reprise` déduite du total). Chaque article rendu : `LigneRetour`, article `EN_STOCK` (prix d'occasion) ou `REBUT`, stock, `MouvementStock` RETOUR (visible dans la fiche IMEI), audit `RETOUR_ENREGISTRE`.
- Avoir : `Client.soldeAvoir`, crédité par un retour en avoir, payé avec le moyen `AVOIR` (jamais de rendu de monnaie ; rendu au client si la vente est annulée). Une vente avec retour ou issue d'un échange ne s'annule plus.
- App : recherche de la vente (numéro, IMEI, client) `retours.tsx`, formulaire `retour/[venteId].tsx`, articles d'une vente ou d'un échange choisis par `components/choix-articles.tsx`. L'instantané envoie aussi les téléphones vendus des ventes des 60 derniers jours.

## Caisse et dépenses

- Règles dans `packages/commun/src/caisse.ts` : `bilanCaisse` (attendu par moyen = fond en espèces + encaissé − monnaie rendue − remboursé − dépensé ; l'avoir n'est pas de l'argent), `ecartsCaisse` (compté − attendu), `erreurCloture` (tout écart, même compensé, se commente). Rapport : `rapport-caisse.ts` (`lignesRapportCaisse` pour le ticket ESC/POS, `rapportCaisseHtml` pour le PDF).
- Opérations : `CAISSE_OUVRIR` (une caisse ouverte par vendeur et boutique), `CAISSE_CLOTURER` (le serveur recalcule l'attendu : `api/src/caisse/caisse.ecritures.ts`), `CAISSE_VALIDER` (gestion), `DEPENSE_ENREGISTRER` (un vendeur paie depuis sa caisse ; la gestion aussi hors caisse). Ventes, retours et dépenses portent `caisseId` : rattachés seulement à la caisse ouverte de leur auteur (`caisseDeRattachement`), sinon la vente reste valable sans caisse.
- L'app exige une caisse ouverte pour vendre ou faire un retour (`lib/caisse-session.ts`, écrans `caisse`, `caisse/[id]`, `depenses`). Justificatif photo : `PUT/GET /api/depenses/:id/justificatif` (dossier privé `justificatifs`, `no-store`), envoyé après la synchronisation de la dépense.
- Numéros de facture : après une base locale recréée, le compteur reprend au plus grand numéro connu de l'appareil (ventes locales, `profil.dernierOrdreFacture`). La déconnexion efface la base en arrière-plan ; `ouvrirBase` attend la fin de cet effacement.

## Factures, reçus et garantie

- Documents construits sur l'appareil depuis la base locale (`app/src/lib/documents.ts` → `DocumentVente`), donc imprimables hors ligne. Mise en page dans `packages/commun/src/documents.ts` : `lignesRecu` (58 mm = 32 colonnes, 80 mm = 48), `recuHtml`, `factureHtml` (A4), `texteMessage` (WhatsApp/SMS), `etatGarantie`, `mentionGarantie` ; dates au fuseau du commerce (`profil.commerce.fuseau`).
- Imprimante thermique : commandes ESC/POS (`escpos.ts`, page de code PC850) envoyées en Bluetooth BLE par `react-native-ble-plx` (`lib/imprimante-bluetooth.ts`, version `.web.ts` sans Bluetooth ; nécessite une version installée, pas Expo Go). Imprimante et largeur choisies dans l'écran `imprimante`, gardées dans `meta`.
- Impression classique et PDF : `lib/impression.ts` (`expo-print` sur téléphone, cadre caché + impression du navigateur sur ordinateur) ; partage du PDF par `expo-sharing` ; WhatsApp (`wa.me`) et SMS avec le résumé texte.
- Garantie par IMEI : `GET /api/ventes/garantie/:imei` (dernière vente validée du commerce), base locale hors ligne ; écran `garantie`.

## Rôles

PROPRIETAIRE (toutes ses boutiques), GERANT (sa ou ses boutiques), VENDEUR (ventes, trocs, encaissements ; jamais de modification de prix).

## Authentification et sécurité

- `api/src/auth` : toutes les routes exigent un jeton, sauf celles marquées `@Public()`. Restreindre par rôle avec `@Roles(Role.X)`. Toute route qui prend un identifiant de boutique porte `@UseGuards(BoutiqueGuard)` (+ `@ParamBoutique('id')` si le paramètre ne s'appelle pas `boutiqueId`). Utilisateur courant : `@UtilisateurCourant()` (`id`, `role`, `commerceId`, `appareilId`, `boutiqueIds`) ; toujours filtrer par `commerceId`.
- Une session = un `Appareil` : jeton d'accès 15 min, jeton de rafraîchissement 30 jours à usage unique (`appareilId.secret`, empreinte en base) ; un ancien jeton réutilisé ferme la session. `JwtAuthGuard` relit l'appareil et le compte à chaque requête : la déconnexion à distance (`/appareils/:id/deconnexion`, `/utilisateurs/:id/deconnexion`) s'applique aussitôt. Qui gère les sessions de qui : `acces.regles.ts`.
- Code PIN (règles dans `packages/commun/src/pin.ts`) : empreinte argon2 sur le serveur, PBKDF2 sur l'appareil (`app/src/lib/pin-local.ts`) pour déverrouiller hors ligne ; 5 erreurs ramènent à la connexion.
- Essais limités par `LimiteurService` (Redis). Opérations sensibles : `AuditService.journaliser` (IP ajoutée automatiquement).
- `api/test/securite.e2e-spec.ts` inventorie les routes : une nouvelle route publique doit être ajoutée à `ROUTES_PUBLIQUES` avec sa justification.
- App : session dans `app/src/lib/session.tsx` (jetons dans expo-secure-store), appels par `api.requete()` qui renouvelle le jeton ; écrans protégés par `Stack.Protected` dans `app/src/app/_layout.tsx`.

## Hors ligne et synchronisation

- Formats partagés dans `packages/commun/src/sync` : entités synchronisées (`entites.ts`), opérations et schémas zod de leur contenu (`operations.ts`), règles de conflit (`conflits.ts`, ex. `controlerSortieArticle` : un IMEI déjà vendu ou sorti ⇒ CONFLIT).
- Nouveau type d'opération : schéma dans `schemasContenus` + libellé, gestionnaire serveur dans `api/src/sync/operations/` (rôles, contrôle avant écriture, écritures, `journal.ecrire`, audit, `corrections`), effet local dans `app/src/lib/sync/operations-locales.ts` (même contrôle), tests des deux côtés.
- Serveur : `POST /sync/operations` idempotent (UUID de l'appareil), une transaction par opération sous verrou du commerce (`JournalService.verrouiller`) ; rejet ou conflit ⇒ rien n'est écrit, l'opération est enregistrée avec son motif et l'état du serveur est renvoyé (`corrections`). Toute modification d'une donnée synchronisée (y compris hors /sync, ex. catalogue) passe par `JournalService.ecrire` dans la même transaction. `GET /sync/instantane` (premier remplissage) puis `GET /sync/changements?curseur=`. Les vendeurs ne reçoivent pas les prix d'achat (`masquerPourRole`).
- App : base SQLite (`app/src/lib/base`, migrations versionnées dans `migrations.ts`, jamais modifier une migration publiée), chiffrée par SQLCipher sur téléphone (version de développement, pas Expo Go), WebAssembly sur le web (en-têtes COOP/COEP : `metro.config.js` en développement, plugin expo-router en production). Écrire uniquement via `useSync().enregistrer(...)` ; lire via `useLecture(...)`. `MoteurSync` envoie la file puis applique la descente seulement si la file est vide. Tests du moteur avec `node:sqlite` (`sql-node.test-utils.ts`).

## Règles

- Interface et messages en français, textes prêts pour d'autres langues.
- Montants entiers, monnaie GNF par défaut, paramétrable par commerce. En base : BigInt (Prisma) ; dans l'API et l'app : number (`convertirBigIntEnJson`, `api/src/common/bigint.ts`).
- Téléphones au format E.164 (indicatif +224 par défaut).
- Toutes les données filtrées par `commerceId` et par les boutiques de l'utilisateur, vérifié côté serveur.
- Un téléphone = un Article identifié par son IMEI, unique par commerce ; un IMEI vendu ne peut plus être vendu.
- Toute opération faite dans l'app passe par la base locale et la file sortante (UUID généré sur l'appareil) ; le serveur l'applique de façon idempotente et fait foi en cas de conflit.
- Jamais d'appel direct à un fournisseur SMS/WhatsApp depuis un module métier : passer par le module Messages.
- Opérations sensibles (remise, prix, annulation, suppression, ajustement de stock) inscrites au journal d'audit.
- Pas de suppression définitive des ventes, clients ou articles : annulation ou archivage.
- Mobile : ajouter une dépendance avec `npx expo install`, jamais `pnpm add`.
- Prettier commun à la racine (guillemets simples).

## Toujours

- Règles métier (prix, remise, troc, échéancier, conflits) dans `/packages/commun`, avec tests unitaires.
- Validation des entrées (class-validator côté API, zod côté app).
- Documentation OpenAPI à jour.
- Vérifier avant de terminer une tâche : `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- Cocher l'étape terminée dans le tableau de `docs/PROMPTS.md`.
