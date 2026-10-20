import { controlerAjustementStock, controlerSortieArticle } from './conflits.js';
import { erreurContenu, schemaLot, schemaOperation } from './operations.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('controlerSortieArticle', () => {
  it('accepte un téléphone en stock ou à réparer dans la boutique', () => {
    expect(controlerSortieArticle({ statut: 'EN_STOCK', boutiqueId: A }, A)).toEqual({ ok: true });
    expect(controlerSortieArticle({ statut: 'A_REPARER', boutiqueId: A }, A)).toEqual({ ok: true });
  });

  it('un IMEI déjà vendu fait passer la seconde opération en conflit', () => {
    expect(controlerSortieArticle({ statut: 'VENDU', boutiqueId: A }, A)).toEqual({
      ok: false,
      statut: 'CONFLIT',
      motif: 'Ce téléphone a déjà été vendu.',
    });
  });

  it('conflit aussi pour un téléphone sorti, en transfert ou dans une autre boutique', () => {
    for (const article of [
      { statut: 'REBUT' as const, boutiqueId: A },
      { statut: 'EN_TRANSFERT' as const, boutiqueId: A },
      { statut: 'EN_STOCK' as const, boutiqueId: B },
    ]) {
      expect(controlerSortieArticle(article, A)).toMatchObject({ ok: false, statut: 'CONFLIT' });
    }
  });

  it('rejette un téléphone inconnu', () => {
    expect(controlerSortieArticle(null, A)).toMatchObject({ ok: false, statut: 'REJETEE' });
  });
});

describe('controlerAjustementStock', () => {
  it('refuse un stock négatif, accepte zéro', () => {
    expect(controlerAjustementStock(3, -3)).toEqual({ ok: true });
    expect(controlerAjustementStock(3, 5)).toEqual({ ok: true });
    expect(controlerAjustementStock(2, -3)).toMatchObject({ ok: false, statut: 'CONFLIT' });
  });
});

describe('schémas des opérations', () => {
  const operation = {
    id: A,
    type: 'STOCK_AJUSTER',
    boutiqueId: B,
    faiteLe: '2026-10-20T08:30:00.000Z',
    contenu: { produitId: A, delta: -2, motif: 'Casse en vitrine' },
  };

  it('valide l’enveloppe et le contenu', () => {
    expect(schemaOperation.safeParse(operation).success).toBe(true);
    expect(erreurContenu('STOCK_AJUSTER', operation.contenu)).toBeNull();
  });

  it('refuse un type inconnu, un identifiant invalide ou un lot vide', () => {
    expect(schemaOperation.safeParse({ ...operation, type: 'INCONNU' }).success).toBe(false);
    expect(schemaOperation.safeParse({ ...operation, id: 'abc' }).success).toBe(false);
    expect(schemaLot.safeParse({ operations: [] }).success).toBe(false);
  });

  it('explique un contenu invalide', () => {
    expect(erreurContenu('STOCK_AJUSTER', { produitId: A, delta: 0, motif: 'ok ok' })).toMatch(
      /ne peut pas être nulle/,
    );
    expect(erreurContenu('ARTICLE_SORTIR', { articleId: A })).not.toBeNull();
  });
});
