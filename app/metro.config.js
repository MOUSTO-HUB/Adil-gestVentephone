// https://docs.expo.dev/guides/customizing-metro/
const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite sur le web : SQLite en WebAssembly, qui a besoin de SharedArrayBuffer,
// donc d'une page « isolée » par ces deux en-têtes. Expo sert certaines pages (dont /)
// avant les middlewares de Metro : on les ajoute à toutes les réponses du serveur de
// développement. En production, le serveur web (Caddy) et le plugin expo-router
// (app.json) les envoient.
const ENTETES_ISOLATION = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
const ecrireEntete = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  for (const [nom, valeur] of Object.entries(ENTETES_ISOLATION)) {
    if (!this.headersSent && !this.hasHeader(nom)) this.setHeader(nom, valeur);
  }
  return ecrireEntete.apply(this, args);
};

config.resolver.assetExts.push('wasm');

module.exports = config;
