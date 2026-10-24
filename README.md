# Adil-gestVentephone

Gestion de vente de téléphones et d'accessoires pour commerçants : catalogue, stock suivi par IMEI, ventes au détail et en gros, troc, vente à crédit par tranches, caisse et dépenses, plusieurs boutiques. L'application fonctionne **sans Internet** et se synchronise dès le retour de la connexion, sur téléphone (Android, iPhone), tablette et ordinateur.

## Documentation

- [Cahier des charges](docs/CAHIER_DES_CHARGES.md)
- [Étapes et prompts de développement](docs/PROMPTS.md)
- [Mise en production](docs/DEPLOIEMENT.md)
- [Guide d'utilisation](docs/guide/README.md) (vendeur, gérant, propriétaire) et [formation des vendeurs](docs/guide/formation-vendeurs.md) ; PDF dans [docs/guide/pdf](docs/guide/pdf)
- [Recette, sécurité et performances](docs/RECETTE.md)

## Structure

| Dossier            | Contenu                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `api/`             | Serveur NestJS + Prisma + PostgreSQL, routes sous `/api`, OpenAPI             |
| `app/`             | Application Expo (React Native) : Android, iOS et web installable             |
| `packages/commun/` | TypeScript pur partagé : types, schémas zod, règles métier (avec leurs tests) |
| `docs/`            | Cahier des charges, étapes et prompts, document Word d'origine                |

## Prérequis

- Node.js 22 ou plus
- pnpm 12 (`corepack enable` active la version indiquée dans `package.json`)
- Docker Desktop (PostgreSQL et Redis)
- Pour tester sur téléphone : l'application Expo Go, ou une version de développement (`eas build --profile development`)

## Lancer en local

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
pnpm db:up
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev:api
```

```bash
pnpm dev:app
```

- Base PostgreSQL sur le port **5434** et Redis sur **6380** (pour ne pas gêner d’autres projets sur 5432, 5433 et 6379).
- Données de démonstration (`pnpm db:seed`) : comptes `proprietaire`, `gerant`, `vendeur1`, `vendeur2` avec le mot de passe `SEED_MOT_DE_PASSE` du `.env` (PIN 2580), 40 produits, 60 IMEI, 10 clients, 3 fournisseurs.
- API : http://localhost:3200/api/sante — documentation OpenAPI : http://localhost:3200/api/docs
- Application : dans le terminal Expo, `w` ouvre la version web (http://localhost:8081), `a` l'émulateur Android ; ou scanner le QR code avec Expo Go. Sur un téléphone physique, mettre l'adresse IP du PC dans `EXPO_PUBLIC_API_URL`.

Après une modification du schéma Prisma (`api/prisma/schema.prisma`) :

```bash
pnpm db:migrate
```

## Vérifications

Avant chaque commit :

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm format:check
```

Tests de bout en bout de l'API (base démarrée) : `pnpm --filter @gestvente/api test:e2e`.

## Avancement

Le code est ajouté étape par étape en suivant [docs/PROMPTS.md](docs/PROMPTS.md).

| Phase              | Contenu                                                          | État    |
| ------------------ | ---------------------------------------------------------------- | ------- |
| 1. Socle           | Catalogue, stock et IMEI, ventes, caisse, hors ligne, 1 boutique | Terminé |
| 2. Troc et crédit  | Reprise d'appareils, crédits, tranches, rappels SMS/WhatsApp     | À faire |
| 3. Multi-boutiques | Boutiques, transferts, tableau consolidé, rapports avancés       | À faire |
