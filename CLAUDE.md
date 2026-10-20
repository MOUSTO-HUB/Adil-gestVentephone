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
