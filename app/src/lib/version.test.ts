import { describe, expect, it } from 'vitest';
import { miseAJourDisponible, versionCourte, versionPubliee } from './version';

describe('nouvelle version du site', () => {
  it('lit la version publiée de version.json', () => {
    expect(versionPubliee({ version: 'ABCDEF1234', publieeLe: '2026-11-25T10:00:00Z' })).toBe(
      'abcdef1234',
    );
    expect(versionPubliee({ version: '<script>' })).toBeNull();
    expect(versionPubliee('texte')).toBeNull();
    expect(versionPubliee(null)).toBeNull();
  });

  it('propose la mise à jour seulement si la version publiée diffère', () => {
    expect(miseAJourDisponible('abc1234', 'abc1234')).toBe(false);
    expect(miseAJourDisponible('ABC1234', 'abc1234')).toBe(false);
    expect(miseAJourDisponible('abc1234', 'def5678')).toBe(true);
    // Développement (pas de version intégrée) ou fichier illisible : rien à proposer.
    expect(miseAJourDisponible(null, 'def5678')).toBe(false);
    expect(miseAJourDisponible('abc1234', null)).toBe(false);
  });

  it('affiche une version courte', () => {
    expect(versionCourte('abcdef1234567')).toBe('abcdef1');
    expect(versionCourte(null)).toBe('dév.');
  });
});
