import { convertirBigIntEnJson } from './bigint.js';

describe('convertirBigIntEnJson', () => {
  beforeAll(() => convertirBigIntEnJson());

  it('envoie les BigInt comme des nombres', () => {
    expect(JSON.stringify({ total: 1_500_000n })).toBe('{"total":1500000}');
  });

  it('refuse un montant qui perdrait sa précision', () => {
    expect(() => JSON.stringify({ total: 2n ** 60n })).toThrow(RangeError);
  });
});
