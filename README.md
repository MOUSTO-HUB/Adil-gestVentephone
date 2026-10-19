# Adil-gestVentephone

Gestion de vente de téléphones et d'accessoires pour commerçants : catalogue, stock suivi par IMEI, ventes au détail et en gros, troc, vente à crédit par tranches, caisse et dépenses, plusieurs boutiques. L'application fonctionne **sans Internet** et se synchronise dès le retour de la connexion, sur téléphone (Android, iPhone), tablette et ordinateur.

## Documentation

- [Cahier des charges](docs/CAHIER_DES_CHARGES.md)
- [Étapes et prompts de développement](docs/PROMPTS.md)

## Stack prévue

| Brique      | Technologie                                           |
| ----------- | ----------------------------------------------------- |
| Serveur     | NestJS, Prisma, PostgreSQL, Redis + BullMQ            |
| Application | Expo (React Native) : Android, iOS, web installable   |
| Hors ligne  | SQLite sur l'appareil, file d'opérations synchronisée |
| Monorepo    | pnpm workspaces (`api`, `app`, `packages/commun`)     |

## Avancement

Le projet démarre : le code sera ajouté étape par étape en suivant [docs/PROMPTS.md](docs/PROMPTS.md) (prompt 1 : initialisation du monorepo).

| Phase              | Contenu                                                          | État    |
| ------------------ | ---------------------------------------------------------------- | ------- |
| 1. Socle           | Catalogue, stock et IMEI, ventes, caisse, hors ligne, 1 boutique | À faire |
| 2. Troc et crédit  | Reprise d'appareils, crédits, tranches, rappels SMS/WhatsApp     | À faire |
| 3. Multi-boutiques | Boutiques, transferts, tableau consolidé, rapports avancés       | À faire |
