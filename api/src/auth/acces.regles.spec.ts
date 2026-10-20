import { Role } from '../generated/prisma/enums.js';
import { type Acteur, peutAccederBoutique, peutGererSessionsDe } from './acces.regles.js';

const acteur = (id: string, role: Role, boutiqueIds: string[], commerceId = 'c1'): Acteur => ({
  id,
  role,
  commerceId,
  boutiqueIds,
});

const proprietaire = acteur('p', Role.PROPRIETAIRE, []);
const gerantA = acteur('g', Role.GERANT, ['A']);
const autreGerant = acteur('g2', Role.GERANT, ['A']);
const vendeurA = acteur('v', Role.VENDEUR, ['A']);
const vendeurB = acteur('w', Role.VENDEUR, ['B']);

describe('peutAccederBoutique', () => {
  it('le propriétaire accède à toutes les boutiques de son commerce', () => {
    expect(peutAccederBoutique(proprietaire, { id: 'Z', commerceId: 'c1' })).toBe(true);
  });

  it("un employé n'accède qu'aux boutiques de son rattachement", () => {
    expect(peutAccederBoutique(vendeurA, { id: 'A', commerceId: 'c1' })).toBe(true);
    expect(peutAccederBoutique(vendeurA, { id: 'B', commerceId: 'c1' })).toBe(false);
  });

  it("personne n'accède à la boutique d'un autre commerce", () => {
    expect(peutAccederBoutique(proprietaire, { id: 'A', commerceId: 'c2' })).toBe(false);
    expect(peutAccederBoutique(vendeurA, { id: 'A', commerceId: 'c2' })).toBe(false);
  });
});

describe('peutGererSessionsDe', () => {
  it('chacun gère ses propres sessions', () => {
    expect(peutGererSessionsDe(vendeurA, vendeurA)).toBe(true);
  });

  it('le propriétaire gère celles de tous ses employés, pas celles d’un autre commerce', () => {
    expect(peutGererSessionsDe(proprietaire, gerantA)).toBe(true);
    expect(peutGererSessionsDe(proprietaire, vendeurB)).toBe(true);
    expect(peutGererSessionsDe(proprietaire, acteur('x', Role.VENDEUR, ['A'], 'c2'))).toBe(false);
  });

  it('un gérant gère les vendeurs de ses boutiques seulement', () => {
    expect(peutGererSessionsDe(gerantA, vendeurA)).toBe(true);
    expect(peutGererSessionsDe(gerantA, vendeurB)).toBe(false);
    expect(peutGererSessionsDe(gerantA, autreGerant)).toBe(false);
    expect(peutGererSessionsDe(gerantA, proprietaire)).toBe(false);
  });

  it('un vendeur ne gère que les siennes', () => {
    expect(peutGererSessionsDe(vendeurA, acteur('v2', Role.VENDEUR, ['A']))).toBe(false);
  });
});
