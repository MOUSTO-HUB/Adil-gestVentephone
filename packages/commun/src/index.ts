// Code partagé par l'API (/api) et l'application (/app).
// Uniquement du TypeScript pur : ni NestJS, ni React Native, ni accès réseau.
// Les règles métier (prix, remise, troc, échéancier, conflits) viennent ici, avec leurs tests.

export * from './achats.js';
export * from './application.js';
export * from './caisse.js';
export * from './catalogue.js';
export * from './clients.js';
export * from './documents.js';
export * from './escpos.js';
export * from './imei.js';
export * from './inventaire.js';
export * from './messages.js';
export * from './monnaie.js';
export * from './pin.js';
export * from './rapport-caisse.js';
export * from './rapports.js';
export * from './retours.js';
export * from './roles.js';
export * from './sync/conflits.js';
export * from './sync/entites.js';
export * from './sync/operations.js';
export * from './telephone.js';
export * from './ventes.js';
