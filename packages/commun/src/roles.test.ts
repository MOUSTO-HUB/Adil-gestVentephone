import { peutGererSessions } from './roles.js';

describe('peutGererSessions', () => {
  it('propriétaire et gérant oui, vendeur non', () => {
    expect(peutGererSessions('PROPRIETAIRE')).toBe(true);
    expect(peutGererSessions('GERANT')).toBe(true);
    expect(peutGererSessions('VENDEUR')).toBe(false);
  });
});
