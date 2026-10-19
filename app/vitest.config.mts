import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests de la logique pure (src/lib sans React Native).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true },
});
