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
- Catalogue de base (`api/src/catalogue/reference.ts`, téléphones et accessoires courants en Guinée, prix en GNF) : installé par `installerCatalogueReference` à la création d'un commerce et à la demande du concepteur ; ajoute seulement ce qui manque (noms comparés par `normaliserRecherche`), ne remplace jamais une saisie du commerçant ; changements écrits au journal pour les appareils. Produits sans photo (photos réservées au troc, étape 15).
- App : recherche locale `rechercherProduits` / `trouverParCode` (`app/src/lib/catalogue.ts`, colonne `recherche` normalisée ; filtres type, marque, modèle avec accessoires compatibles, en stock d'abord, pastilles dans `components/choix-articles.tsx`), scan caméra (`components/scanner.tsx`, téléphone) ou lecteur USB (le code tapé puis Entrée dans le champ de recherche ouvre la fiche).

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

- Règles dans `packages/commun/src/retours.ts` : `erreurConditionsRetour` (délai `Commerce.delaiRetourJours` ; appareil endommagé par le client refusé ; au-delà du délai, seul un appareil en panne sous garantie s'échange), `valeurRetour` (prix payé, remise de la vente au prorata, arrondie comme dans les rapports), `bilanRetour` (remboursement, avoir, ou échange : `reprise`, `aPayer`, `aRendre`), `erreurDestination` (neuf, occasion avec `prixRevente` pour un téléphone, rebut).
- Opération `RETOUR_ENREGISTRER` (écritures `api/src/retours/retours.ecritures.ts`) : gérant ou propriétaire ; un vendeur joint le jeton de `POST /api/ventes/autorisations-retour` (PIN du gérant, valable pour cette vente). L'échange crée une nouvelle vente par `enregistrerVente(ctx, vente, reprise)` (`Vente.reprise` déduite du total). Chaque article rendu : `LigneRetour`, article `EN_STOCK` (prix d'occasion) ou `REBUT`, stock, `MouvementStock` RETOUR (visible dans la fiche IMEI), audit `RETOUR_ENREGISTRE`.
- Avoir : `Client.soldeAvoir`, crédité par un retour en avoir, payé avec le moyen `AVOIR` (jamais de rendu de monnaie ; rendu au client si la vente est annulée). Une vente avec retour ou issue d'un échange ne s'annule plus.
- App : recherche de la vente (numéro, IMEI, client) `retours.tsx`, formulaire `retour/[venteId].tsx`, articles d'une vente ou d'un échange choisis par `components/choix-articles.tsx`. L'instantané envoie aussi les téléphones vendus des ventes des 60 derniers jours.

## Caisse et dépenses

- Règles dans `packages/commun/src/caisse.ts` : `bilanCaisse` (attendu par moyen = fond en espèces + encaissé − monnaie rendue − remboursé − dépensé ; l'avoir n'est pas de l'argent), `ecartsCaisse` (compté − attendu), `erreurCloture` (tout écart, même compensé, se commente). Rapport : `rapport-caisse.ts` (`lignesRapportCaisse` pour le ticket ESC/POS, `rapportCaisseHtml` pour le PDF).
- Opérations : `CAISSE_OUVRIR` (une caisse ouverte par vendeur et boutique), `CAISSE_CLOTURER` (le serveur recalcule l'attendu : `api/src/caisse/caisse.ecritures.ts`), `CAISSE_VALIDER` (gestion), `DEPENSE_ENREGISTRER` (un vendeur paie depuis sa caisse ; la gestion aussi hors caisse). Ventes, retours et dépenses portent `caisseId` : rattachés seulement à la caisse ouverte de leur auteur (`caisseDeRattachement`), sinon la vente reste valable sans caisse.
- L'app exige une caisse ouverte pour vendre ou faire un retour (`lib/caisse-session.ts`, écrans `caisse`, `caisse/[id]`, `depenses`). Justificatif photo : `PUT/GET /api/depenses/:id/justificatif` (dossier privé `justificatifs`, `no-store`), envoyé après la synchronisation de la dépense.
- Numéros de facture : après une base locale recréée, le compteur reprend au plus grand numéro connu de l'appareil (ventes locales, `profil.dernierOrdreFacture`). La déconnexion efface la base en arrière-plan ; `ouvrirBase` attend la fin de cet effacement.

## Rapports et journal d'audit

- Calculs dans `packages/commun/src/rapports.ts` : `rapportVentes` (CA net = ventes, remise au prorata de chaque ligne, moins les retours du jour du retour ; bénéfice brut = CA net − coût, le coût des articles revenus en stock est récupéré, pas celui du rebut ; par période `clePeriode` jour/semaine ISO/mois au fuseau du commerce, vendeur, produit), `rapportStock` (valeur au prix d'achat et de vente, téléphones au coût réel de chaque IMEI ; sans vente depuis N jours), `rapportHtml` (PDF), `LIBELLES_ACTIONS_AUDIT`, `FAMILLES_AUDIT`.
- API (`api/src/rapports`, propriétaire et gérants de la boutique) : `GET /api/rapports/ventes|stock|caisse` (chaque route n'accepte que ses paramètres), `GET /api/rapports/excel?type=` (exceljs), `GET /api/audit` (filtres utilisateur, boutique, actions, période ; pages par `avant` ; un gérant voit ses boutiques et les connexions de son personnel), `GET /api/audit/utilisateurs`.
- App : écrans `rapports` (hors ligne : ventes et stock recalculés sur la base de l'appareil, `lib/rapports.ts`) et `journal` (en ligne). Export Excel : `lib/export-excel.ts` (téléchargement sur ordinateur, partage sur téléphone par `expo-file-system`).

## Messagerie (SMS, WhatsApp)

- Tout envoi passe par `MessagesService.envoyer(tx, { commerceId, destinataire, type, variables, canal, … })` (`api/src/messages`) : jamais un fournisseur depuis un module métier. Le message est inscrit (statut, essais, coût, erreur) puis confié à BullMQ (Redis, `jobId` = id du message) : 3 essais à délai croissant (`MESSAGES_DELAI_MS`), au dernier échec WhatsApp bascule vers un SMS. Messages restés en attente renvoyés dans la file au démarrage.
- Fournisseurs derrière `SmsSender` / `WhatsAppSender` (`fournisseurs.ts`) : `SMS_FOURNISSEUR` = journal (développement, texte dans les journaux) ou http (passerelle locale) ; `WHATSAPP_FOURNISSEUR` = aucun (tout en SMS), journal ou cloud (API WhatsApp Business Cloud, modèles approuvés `gestvente_<type>`, paramètres `PARAMETRES_WHATSAPP`). Échecs simulés : `MESSAGES_ECHEC_SMS`, `MESSAGES_ECHEC_WHATSAPP`.
- Textes : `packages/commun/src/messages.ts` (`MODELES_PAR_DEFAUT`, variables {client} {montant} {monnaie} {echeance} {boutique} {lien} {numero} {commerce}, `texteSms` : 160 caractères au plus, lien gardé). Le propriétaire modifie les textes SMS (`PUT /api/messages/modeles`, table `ModeleMessage`, audit `MODELE_MESSAGE_MODIFIE`) ; les textes WhatsApp sont les modèles approuvés par Meta.
- Facture envoyée : opération `MESSAGE_ENVOYER` (demandée sur l'appareil, même hors ligne ; envoyée quand l'opération arrive) ; lien public `GET /api/f/:code` (`Vente.codePublic`, 10 caractères aléatoires, page sans script). `URL_PUBLIQUE` = adresse du site. Écrans : option d'envoi à la vente, « Envoyer au client » sur le détail, écran `messages` (historique, relance, textes).

## Troc (reprise d'appareils)

- Règles dans `packages/commun/src/troc.ts` : `etatGlobal` (écran, batterie, boîtier, fonctionnement), `valeurProposee` (grille du modèle et de la capacité, sinon du modèle, sinon `COEFFICIENTS_REPRISE` × prix du neuf arrondi à 5 000), `plafondReprise` (vendeur : + `Commerce.repriseMaxVendeur` %, 10 par défaut ; gérant et propriétaire sans limite), `erreurReprise`, `erreurClientTroc` (fiche client avec type et numéro de pièce obligatoire), `schemaTroc` joint à `schemaVente.troc`.
- Serveur (`api/src/trocs/troc.ecritures.ts`) : `controlerTroc` avant toute écriture de la vente (IMEI signalé actif ⇒ CONFLIT, déjà en stock ⇒ CONFLIT, valeur proposée = la plus haute du serveur et de l'appareil), puis `ecrireTroc` : article `origine TROC` (`A_REPARER`, ou `EN_STOCK` avec `prixRevente`), coût = valeur retenue, stock +1, mouvement `TROC_ENTREE`, audit `TROC_ENREGISTRE` (+ `REPRISE_AJUSTEE`). Un IMEI déjà vendu par le commerce réutilise son article (l'article provisoire de l'appareil est effacé par le journal). Vente avec troc : pas d'annulation, pas de troc dans un échange.
- Au-delà de la limite : `POST /api/ventes/autorisations-reprise` (PIN du gérant, jeton lié au troc et à la valeur). Opérations `GRILLE_REPRISE_ENREGISTRER` (propriétaire, remplace les lignes d'un modèle et d'une capacité), `IMEI_SIGNALER` et `ARTICLE_REMETTRE_EN_VENTE` (gestion). Entités synchronisées `troc` (60 jours), `grilleReprise`, `imeiSignale`.
- Photos (4 au plus) : fichiers `STOCKAGE_DIR/trocs`, jamais dans la base ; `POST /api/trocs/:id/photos` après la synchronisation, `GET /api/trocs/:id/photos/:n` sans cache. Le chiffre d'affaires reste le prix de vente : la reprise est un moyen de règlement, et l'appareil repris coûte sa valeur à la revente.
- App : `components/saisie-troc.tsx` dans l'écran de vente (alerte bloquante IMEI signalé ou en stock, hors ligne), `lib/troc.ts`, `lib/photos-troc.ts`, `lib/sync/operations-trocs.ts`, écrans `trocs` (photos, remise en vente), `grille-reprise` (propriétaire), `imei-signales`.

## Vente à crédit et tranches

- Règles dans `packages/commun/src/credit.ts` : `echeancier` (tranches égales arrondies, la dernière ajustée ; `decalerJour` : semaine ou même jour du mois, fin de mois respectée), dates d'échéance en jours `AAAA-MM-JJ` au fuseau du commerce (`jourLocal`), `erreurFicheCredit` (téléphone, pièce, adresse), `erreurPlafondCredit` (encours + nouveau ≤ `Client.plafondCredit` ; sans plafond, pas de crédit), `erreurConditionsCredit`, `repartirEncaissement` (de la tranche la plus ancienne à la plus récente, jamais au-delà du dû), `situationCredit` (reste, retard, échu, prochaine tranche). Documents : `documents-credit.ts` (`contratCreditHtml` A4 signé, `lignesRecuEncaissement` / `recuEncaissementHtml` avec le solde).
- `schemaVente.credit` (apport, tranches, fréquence, première échéance, garant, identifiants des tranches donnés par l'appareil) : la vente passe en `mode CREDIT`, seul l'apport est payé (`montantPaye`), `paiements` peut être vide. Serveur `api/src/credits/credit.ecritures.ts` : `controlerCredit` avant écriture (fiche ⇒ REJETEE, plafond sur l'encours de tout le commerce ⇒ CONFLIT), `ecrireCredit`, audit `CREDIT_ACCORDE`. Vente à crédit : ni annulation ni retour (à traiter par le gérant).
- Opération `CREDIT_ENCAISSER` (tout le personnel, hors ligne, rattachée à la caisse ouverte) : tranches, `montantRestant`, crédit `SOLDE` ; au-delà du dû ⇒ CONFLIT ; audit `ENCAISSEMENT_CREDIT`. `bilanCaisse` compte `encaissements` (serveur, appareil, rapport de caisse). Entités `credit` (tous ceux en cours + 60 jours), `echeance`, `encaissement`.
- App : `components/saisie-credit.tsx` (plafond, encours, échéancier en direct), `lib/credit-saisie.ts`, `lib/credits.ts`, `lib/sync/operations-credits.ts`, écrans `credits` (en cours, en retard, soldés, total dû) et `credit/[id]` (échéancier, encaissement, reçu, contrat), impression par `components/impression-document.tsx`.

## Rappels et pénalités

- Règles dans `packages/commun/src/rappels.ts` : `rappelDu` (un message par crédit et par jour : relance de retard de tout l'échu tous les `INTERVALLE_RELANCE_JOURS` jours jusqu'à `relancesMax`, sinon rappel du jour, sinon rappel N jours avant, rattrapé si la tâche a manqué un jour), `apresRappel`, `prochainRappel` (affiché sur la fiche), `penaliteDue` (une fois par tranche, après le délai de grâce, fixe ou % de la tranche), `schemaParametresRappels`.
- Réglages sur `Commerce` (`rappelJoursAvant`, `relancesMax`, `canalRappels`, `penaliteActive`, `penaliteType`, `penaliteValeur`, `penaliteGrace`) : `GET /api/credits/parametres` (gestion), `PUT` (propriétaire, audit `PARAMETRES_RAPPELS`), aussi dans `profil.commerce.rappels`. `Echeance.dernierRappelLe` (minuit UTC du jour de la boutique), `nombreRelances`.
- `api/src/credits/rappels.service.ts` : tâche BullMQ (`upsertJobScheduler`, 9 h Africa/Conakry ; jours comptés au fuseau du commerce) sur les commerces en service et boutiques ouvertes ; pénalités (audit `PENALITE_APPLIQUEE`) puis rappel par `MessagesService` (`RAPPEL_ECHEANCE` / `RETARD_ECHEANCE`), journal des tranches. `executer(date, commerces)` pour les tests. « Relancer maintenant » : `POST /api/credits/:id/relancer` (gestion, audit `RELANCE_MANUELLE`).
- App : écran `rappels` (propriétaire ; lecture seule pour les gérants), prochain rappel, pénalités et bouton de relance sur `credit/[id]`.

## Factures, reçus et garantie

- Documents construits sur l'appareil depuis la base locale (`app/src/lib/documents.ts` → `DocumentVente`), donc imprimables hors ligne. Mise en page dans `packages/commun/src/documents.ts` : `lignesRecu` (58 mm = 32 colonnes, 80 mm = 48), `recuHtml`, `factureHtml` (A4), `texteMessage` (WhatsApp/SMS), `etatGarantie`, `mentionGarantie` ; dates au fuseau du commerce (`profil.commerce.fuseau`).
- Imprimante thermique : commandes ESC/POS (`escpos.ts`, page de code PC850) envoyées en Bluetooth BLE par `react-native-ble-plx` (`lib/imprimante-bluetooth.ts`, version `.web.ts` sans Bluetooth ; nécessite une version installée, pas Expo Go). Imprimante et largeur choisies dans l'écran `imprimante`, gardées dans `meta`.
- Impression classique et PDF : `lib/impression.ts` (`expo-print` sur téléphone, cadre caché + impression du navigateur sur ordinateur) ; partage du PDF par `expo-sharing` ; WhatsApp (`wa.me`) et SMS avec le résumé texte.
- Garantie par IMEI : `GET /api/ventes/garantie/:imei` (dernière vente validée du commerce), base locale hors ligne ; écran `garantie`.

## Interface

- Charte dans `app/src/lib/theme.ts` (`useCouleurs()` : indigo, ambre pour la vente, états vert/orange/rouge ; clair et sombre) : jamais de couleur en dur dans un écran. Composants de `components/ui.tsx` : `Ecran` (en-tête coloré, flèche de retour : pas de bouton « Retour » en bas d'écran), `Bouton` (`icone` Ionicons, variantes principal/secondaire/accent/danger), `Carte`, `Message` (erreur/info/succes), `Section`, `Grille`, `Tuile`, `Indicateur`. Icônes : `@expo/vector-icons/Ionicons`. Icônes de l'application dessinées par `app/scripts/icones.cjs`.

## Production

- `docker-compose.prod.yml` : Caddy (HTTPS, site installable exporté par `deploy/web.Dockerfile`, relais `/api`), API (`deploy/api.Dockerfile`, `prisma migrate deploy` au démarrage), PostgreSQL, Redis, sauvegarde chiffrée quotidienne (`deploy/sauvegarde.sh`, rotation). Secrets dans `.env.prod` (modèle `deploy/production.env.example`). Guide : `docs/DEPLOIEMENT.md`.
- Premier compte : `node dist/cli/initialiser.js` crée le concepteur (mot de passe affiché une fois) ; les commerçants se créent dans l'espace concepteur.
- Site installable : `app/public` (`index.html`, `manifest.json`, `sw.js` : coquille hors ligne, jamais l'API en cache, `icones/`). Application mobile : `app/eas.json` (APK `preview`, AAB et iOS `production`, canaux EAS Update), `runtimeVersion` = version de l'application.
- CI : `.github/workflows/ci.yml` (lint, types, format, tests, e2e avec PostgreSQL et Redis, compilation, export web, images Docker). Recette de la phase 1 : `api/test/recette.e2e-spec.ts`.

## Espace concepteur (plateforme)

- Compte `Concepteur` distinct des commerçants (seed : `concepteur`) ; jeton `{ type: 'concepteur' }` de 10 h, refusé par `JwtAuthGuard` (pas d'appareil). Routes `/api/plateforme` (`api/src/plateforme`) : `@Public()` + `@UseGuards(ConcepteurGuard)`, actions auditées `PLATEFORME_*`.
- Commerce `statut` ACTIF / SUSPENDU / SUPPRIME (jamais effacé, restaurable) ; boutique `verrouillee`, `supprimeeLe`. Contrôlés par `refusCommerce` et `BOUTIQUE_OUVERTE` (`acces.regles.ts`) à la connexion, au renouvellement, dans `JwtAuthGuard`, `BoutiqueGuard` et la synchronisation (opération REJETEE).
- App : écrans `app/src/app/plateforme` (session `lib/plateforme.tsx`, sans base locale), lien « Espace concepteur » sous la connexion ; route ouverte quel que soit l'état de la session du commerçant.

## Rôles

PROPRIETAIRE (toutes ses boutiques), GERANT (sa ou ses boutiques), VENDEUR (ventes, trocs, encaissements ; jamais de modification de prix).

## Boutiques et équipe

- `api/src/equipe` : le propriétaire crée des boutiques sans limite (`POST /api/boutiques`, préfixe unique et définitif ; `PATCH /api/boutiques/:id` nom et coordonnées) et gère les employés (`/api/employes` : création avec mot de passe provisoire affiché une fois, rôle GERANT ou VENDEUR, une ou plusieurs boutiques, désactivation qui révoque les appareils, `POST /api/employes/:id/mot-de-passe`) ; le gérant lit l'équipe de ses boutiques. Audit `BOUTIQUE_CREEE`, `BOUTIQUE_MODIFIEE`, `EMPLOYE_CREE`, `EMPLOYE_MODIFIE`, `MOT_DE_PASSE_REINITIALISE`.
- Rattachements relus à chaque requête (`JwtAuthGuard`) ; `Instantane` et `PageChangements` portent `boutiques` : quand la liste change, le moteur de l'appareil (`meta.boutiques`) reprend un instantané complet. Prix communs sur `Produit`, prix de boutique (`PrixBoutique`) prioritaires.
- `api/test/isolation.e2e-spec.ts` parcourt toutes les routes de la documentation qui prennent une boutique (chemin, requête ou corps) avec un employé d'une autre boutique : 403 ou 404 attendu. App : écrans `boutiques` (propriétaire) et `equipe`.

## Transferts entre boutiques

- Règles dans `packages/commun/src/transferts.ts` (schémas, `bilanReception` : téléphones scannés, accessoires comptés au plus l'envoyé, écarts et inattendus). Opérations hors ligne : `TRANSFERT_DEMANDER` (boutique qui reçoit, gestion), `TRANSFERT_ENVOYER` (boutique de départ : prépare une demande en remplaçant ses lignes, ou envoi direct réservé au propriétaire ; téléphones `EN_TRANSFERT`, stock de départ diminué, `TRANSFERT_SORTIE`), `TRANSFERT_RECEVOIR` (tout le personnel de l'arrivée ; seul le reçu entre en stock, `TRANSFERT_ENTREE` ; téléphones manquants restés `EN_TRANSFERT`, audit `TRANSFERT_ECART`), `TRANSFERT_ANNULER` (demande : l'une ou l'autre boutique ; envoi non reçu : le départ, tout revient).
- Serveur `api/src/transferts/transferts.ecritures.ts` ; le journal écrit le transfert et ses lignes pour chacune des deux boutiques ; à la réception, le téléphone quitte les appareils du départ (`donnees: null`) puis arrive chez ceux de l'arrivée. `LigneTransfertSync.imei` permet le scan à l'arrivée. Fiche IMEI : numéro et boutiques du transfert. `GET /api/boutiques` : noms des boutiques ouvertes du commerce (gardés dans `meta` pour le hors ligne).
- App : `lib/transferts.ts`, `lib/sync/operations-transferts.ts`, écrans `transferts` (à recevoir, à préparer, tous ; badge sur l'accueil), `transfert/nouveau` (demande, envoi direct), `transfert/[id]` (préparation, réception par scan avec écarts, annulation). `SaisieImei` accepte un contrôle `refus`.

## Tableau de bord consolidé

- `packages/commun/src/tableau.ts` : `ChiffresBoutique`, `totaliser` (la synchronisation la plus ancienne ressort), `periodePrecedente`, `evolution`, `situationTrocs` (repris, réparés, en vente, revendus, marge = revente − reprise).
- `api/src/tableau` : `GET /api/tableau` (propriétaire : toutes ses boutiques ; gérant : les siennes ; `boutiqueId` facultatif ; période d'un an au plus) en requêtes SQL agrégées par boutique (chiffre d'affaires arrondi par ligne comme `rapportVentes`, donc identique aux rapports par boutique ; index `Vente(boutiqueId, dateVente)`, `Retour(boutiqueId, dateRetour)`, `OperationSync(boutiqueId, recueLe)`, `Credit(boutiqueId, statut)`), période précédente, séries par période et boutique ; `GET /api/tableau/trocs` ; `GET /api/tableau/excel`. Dernière synchronisation d'une boutique : dernière opération reçue d'un de ses appareils.
- Exports planifiés : `RapportsPlanifiesService`, tâche BullMQ chaque jour à 7 h (Conakry) qui crée, une seule fois, le classeur de la dernière semaine et du dernier mois complets de chaque commerce (`RapportArchive`, fichiers `STOCKAGE_DIR/rapports`) ; `GET /api/tableau/archives` (propriétaire). Pas de vue matérialisée : les agrégats indexés suffisent aux volumes d'une boutique.
- App : écran `tableau` (en ligne : période, boutique, indicateurs, barres par boutique, évolution, trocs, PDF par `rapportHtml`, Excel, rapports planifiés).

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
- App : base SQLite (`app/src/lib/base`, migrations versionnées dans `migrations.ts`, jamais modifier une migration publiée), chiffrée par SQLCipher sur téléphone (version de développement, pas Expo Go), WebAssembly sur le web (en-têtes COOP/COEP : `metro.config.js` en développement, `deploy/Caddyfile` en production). Écrire uniquement via `useSync().enregistrer(...)` ; lire via `useLecture(...)`. `MoteurSync` envoie la file puis applique la descente seulement si la file est vide. Tests du moteur avec `node:sqlite` (`sql-node.test-utils.ts`).

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
