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
      DATABASE_URL:
        process.env.DATABASE_URL ??
        'postgresql://gestvente:gestvente_dev@localhost:5434/gestvente?schema=public',
    },
  },
});
