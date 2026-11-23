import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/**
 * CORS de l'API : seules les origines du site (APP_ORIGIN, séparées par des virgules).
 * `credentials` : le site envoie les cookies de l'hébergeur (défi anti-robots d'o2switch,
 * cookie `o2s-chl`) ; l'API, elle, n'utilise aucun cookie (jeton dans l'en-tête Authorization).
 */
export function optionsCors(appOrigin = process.env.APP_ORIGIN): CorsOptions {
  const origines = (appOrigin ?? 'http://localhost:8081')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return { origin: origines, credentials: true };
}
