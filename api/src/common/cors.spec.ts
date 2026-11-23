import { describe, expect, it } from 'vitest';
import { optionsCors } from './cors.js';

describe('optionsCors', () => {
  it('autorise les origines du site, cookies compris', () => {
    expect(optionsCors('https://app.exemple.com, https://autre.exemple.com/')).toEqual({
      origin: ['https://app.exemple.com', 'https://autre.exemple.com'],
      credentials: true,
    });
  });

  it('se rabat sur le site de développement', () => {
    expect(optionsCors(undefined).origin).toEqual(['http://localhost:8081']);
    expect(optionsCors('').origin).toEqual([]);
  });
});
