import {
  motsRecherche,
  nomPropose,
  normaliserRecherche,
  prixApplicables,
  schemaPrixBoutique,
  schemaProduit,
  texteRecherche,
} from './catalogue.js';

const ID = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';

const produit = {
  id: ID,
  type: 'ACCESSOIRE' as const,
  categorieId: AUTRE,
  marqueId: null,
  modeleId: null,
  nom: 'Coque iPhone 13',
  capacite: null,
  couleur: null,
  etat: 'NEUF' as const,
  codeBarres: '6200001001',
  garantieMois: 0,
  prixAchat: 25_000,
  prixDetail: 50_000,
  prixGros: 40_000,
  seuilGros: 10,
  archive: false,
  compatibles: [AUTRE],
};

const erreurs = (valeur: unknown) => {
  const r = schemaProduit.safeParse(valeur);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('schemaProduit', () => {
  it('accepte un accessoire avec ses modèles compatibles', () => {
    expect(erreurs(produit)).toEqual([]);
  });

  it('refuse un prix de gros supérieur au détail, un montant non entier ou négatif', () => {
    expect(erreurs({ ...produit, prixGros: 60_000 })).toContain(
      'Le prix de gros ne peut pas dépasser le prix de détail.',
    );
    expect(erreurs({ ...produit, prixAchat: 10.5 })).toContain('Montant entier attendu.');
    expect(erreurs({ ...produit, prixAchat: -1 })).toContain('Montant négatif.');
  });

  it('un modèle pour un téléphone, des compatibilités pour un accessoire', () => {
    expect(erreurs({ ...produit, modeleId: AUTRE })).toHaveLength(1);
    expect(erreurs({ ...produit, type: 'TELEPHONE' })).toContain(
      'Seuls les accessoires ont des modèles compatibles.',
    );
    expect(erreurs({ ...produit, type: 'TELEPHONE', compatibles: [], modeleId: AUTRE })).toEqual(
      [],
    );
  });

  it('contrôle le code-barres et le seuil de gros', () => {
    expect(erreurs({ ...produit, codeBarres: '12' })).toHaveLength(1);
    expect(erreurs({ ...produit, codeBarres: null, seuilGros: null })).toEqual([]);
    expect(erreurs({ ...produit, seuilGros: 1 })).toHaveLength(1);
  });
});

describe('schemaPrixBoutique', () => {
  it('accepte des prix partiels, refuse un gros supérieur au détail', () => {
    const base = { produitId: ID, prixAchat: null, prixDetail: 55_000, prixGros: null };
    expect(schemaPrixBoutique.safeParse(base).success).toBe(true);
    expect(schemaPrixBoutique.safeParse({ ...base, prixGros: 60_000 }).success).toBe(false);
  });
});

describe('prixApplicables', () => {
  it('les prix de la boutique remplacent les prix communs, un par un', () => {
    expect(
      prixApplicables(produit, { prixAchat: null, prixDetail: 55_000, prixGros: null }),
    ).toEqual({ prixAchat: 25_000, prixDetail: 55_000, prixGros: 40_000 });
    expect(prixApplicables(produit, null)).toEqual({
      prixAchat: 25_000,
      prixDetail: 50_000,
      prixGros: 40_000,
    });
  });
});

describe('recherche', () => {
  it('ignore la casse, les accents et la ponctuation', () => {
    expect(normaliserRecherche('  Câble USB-C 1 m ')).toBe('cable usb c 1 m');
    expect(motsRecherche('Écouteurs, Bluetooth')).toEqual(['ecouteurs', 'bluetooth']);
  });

  it('indexe le nom, la capacité, la couleur et le code-barres', () => {
    expect(
      texteRecherche({
        nom: 'Galaxy A15',
        capacite: '128 Go',
        couleur: 'Noir',
        codeBarres: 'AB12',
      }),
    ).toBe('galaxy a15 128 go noir ab12');
  });

  it('propose un nom de variante', () => {
    expect(
      nomPropose({
        marque: 'Samsung',
        modele: 'Galaxy A15',
        capacite: '128 Go',
        couleur: ' Noir ',
      }),
    ).toBe('Samsung Galaxy A15 128 Go Noir');
    expect(nomPropose({ marque: 'Oraimo', modele: null })).toBe('Oraimo');
  });
});
