// Code partagé par l'API (/api) et l'application (/app).
// Uniquement du TypeScript pur : ni NestJS, ni React Native, ni accès réseau.
// Les règles métier (prix, remise, troc, échéancier, conflits) viennent ici, avec leurs tests.

export * from './application.js';
export * from './imei.js';
export * from './monnaie.js';
export * from './pin.js';
export * from './roles.js';
