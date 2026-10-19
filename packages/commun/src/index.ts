// Code partagé par l'API (/api) et l'application (/app).
// Uniquement du TypeScript pur : ni NestJS, ni React Native, ni accès réseau.
// Les règles métier (prix, remise, troc, échéancier, conflits) viendront ici, avec leurs tests.

export * from './application.js';
export * from './monnaie.js';
