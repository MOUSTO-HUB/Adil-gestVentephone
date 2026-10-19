// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  // Version donnée explicitement : la détection automatique d'eslint-plugin-react
  // n'est pas compatible avec ESLint 10.
  { settings: { react: { version: '19.2' } } },
  { ignores: ['dist/*', '.expo/*'] },
]);
