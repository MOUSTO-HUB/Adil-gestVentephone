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

## Rôles

PROPRIETAIRE (toutes ses boutiques), GERANT (sa ou ses boutiques), VENDEUR (ventes, trocs, encaissements ; jamais de modification de prix).

## Règles

- Interface et messages en français, textes prêts pour d'autres langues.
- Montants entiers, monnaie GNF par défaut, paramétrable par commerce.
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
