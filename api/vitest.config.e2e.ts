import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Valeurs par défaut = docker-compose ; un .env ou l'environnement les remplace.
    env: {
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6380',
      JWT_SECRET: process.env.JWT_SECRET ?? 'secret-e2e-uniquement-pour-les-tests-0123456789',
      // Compteurs de limite propres aux tests e2e.
      REDIS_PREFIXE: `gestvente-e2e-${Date.now()}`,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://gestvente:gestvente_dev@localhost:5434/gestvente?schema=public',
    },
  },
});
