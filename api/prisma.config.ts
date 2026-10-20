import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Le .env est à la racine du monorepo ; api/.env reste possible en local.
config({ path: ['.env', '../.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
