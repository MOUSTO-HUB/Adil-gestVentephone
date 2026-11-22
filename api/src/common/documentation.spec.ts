import { describe, expect, it } from 'vitest';
import { documentationPublique } from './documentation.js';

describe('documentationPublique', () => {
  it('publie la documentation hors production', () => {
    expect(documentationPublique({ NODE_ENV: 'development' })).toBe(true);
    expect(documentationPublique({ NODE_ENV: 'test' })).toBe(true);
    expect(documentationPublique({})).toBe(true);
  });

  it('la masque en production', () => {
    expect(documentationPublique({ NODE_ENV: 'production' })).toBe(false);
  });

  it('suit DOCS_API quand elle est renseignée', () => {
    expect(documentationPublique({ NODE_ENV: 'production', DOCS_API: 'publique' })).toBe(true);
    expect(documentationPublique({ NODE_ENV: 'production', DOCS_API: ' Publique ' })).toBe(true);
    expect(documentationPublique({ NODE_ENV: 'development', DOCS_API: 'masquee' })).toBe(false);
  });

  it('ignore une valeur inconnue', () => {
    expect(documentationPublique({ NODE_ENV: 'production', DOCS_API: 'oui' })).toBe(false);
    expect(documentationPublique({ NODE_ENV: 'development', DOCS_API: '' })).toBe(true);
  });
});
