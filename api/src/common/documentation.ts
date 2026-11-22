/**
 * Publication de la documentation OpenAPI (/api/docs et /api/docs-json).
 * Visible en développement et en test ; masquée en production, sauf `DOCS_API=publique`.
 * `DOCS_API=masquee` la masque dans tous les cas.
 */
export function documentationPublique(env: NodeJS.ProcessEnv = process.env): boolean {
  const choix = env.DOCS_API?.trim().toLowerCase();
  if (choix === 'publique') return true;
  if (choix === 'masquee') return false;
  return env.NODE_ENV !== 'production';
}
