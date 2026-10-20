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
- Docker : PostgreSQL sur le port 5434, Redis sur 6380. Seed : `pnpm db:seed` (comptes proprietaire, gerant, vendeur1, vendeur2 ; mot de passe `SEED_MOT_DE_PASSE`, PIN 1234).

## Rôles

PROPRIETAIRE (toutes ses boutiques), GERANT (sa ou ses boutiques), VENDEUR (ventes, trocs, encaissements ; jamais de modification de prix).

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
