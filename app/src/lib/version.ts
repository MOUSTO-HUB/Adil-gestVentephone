/**
 * Version de l'application et détection d'une nouvelle version publiée.
 *
 * Site (navigateur ou application installée sur téléphone / ordinateur) : la version du
 * site est intégrée au moment de la construction (`EXPO_PUBLIC_VERSION_SITE`, empreinte du
 * code) ; le fichier `version.json` du site en ligne donne la dernière version publiée.
 * Une différence signifie qu'une mise à jour attend : l'utilisateur actualise.
 */

/** Version intégrée à ce site (absente en développement : aucune vérification). */
export const VERSION_SITE: string | null = process.env.EXPO_PUBLIC_VERSION_SITE || null;

/** Délai entre deux vérifications pendant que l'application est ouverte. */
export const VERIFICATION_MS = 5 * 60_000;

/** Après « Plus tard », le bandeau revient au bout de ce délai. */
export const REPORT_MS = 30 * 60_000;

/** Forme courte affichée à l'écran (7 premiers caractères de l'empreinte). */
export const versionCourte = (version: string | null) => (version ? version.slice(0, 7) : 'dév.');

/** Lit la version publiée dans le contenu de `version.json` ; null si illisible. */
export function versionPubliee(contenu: unknown): string | null {
  if (!contenu || typeof contenu !== 'object') return null;
  const version = (contenu as { version?: unknown }).version;
  return typeof version === 'string' && /^[0-9a-f]{7,64}$/i.test(version.trim())
    ? version.trim().toLowerCase()
    : null;
}

/** Une nouvelle version est en ligne quand la version publiée diffère de la nôtre. */
export function miseAJourDisponible(locale: string | null, publiee: string | null): boolean {
  return !!locale && !!publiee && locale.trim().toLowerCase() !== publiee;
}
