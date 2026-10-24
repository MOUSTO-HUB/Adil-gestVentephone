import { describe, expect, it } from 'vitest';
import { bilanReception, erreurBoutiquesTransfert, schemaEnvoiTransfert } from './transferts.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('transferts', () => {
  const lignes = [
    { id: id(1), produitId: id(10), articleId: id(100), quantite: 1 },
    { id: id(2), produitId: id(10), articleId: id(101), quantite: 1 },
    { id: id(3), produitId: id(20), articleId: null, quantite: 10 },
  ];

  it('réception : téléphones scannés, accessoires comptés, écarts signalés', () => {
    expect(
      bilanReception(lignes, {
        articlesRecus: [id(100), id(999)],
        quantites: [{ ligneId: id(3), quantite: 8 }],
      }),
    ).toEqual({
      recues: [
        { ligneId: id(1), quantite: 1 },
        { ligneId: id(2), quantite: 0 },
        { ligneId: id(3), quantite: 8 },
      ],
      ecarts: [
        { ligneId: id(2), envoye: 1, recu: 0 },
        { ligneId: id(3), envoye: 10, recu: 8 },
      ],
      inattendus: [id(999)],
    });
  });

  it('pas plus que ce qui a été envoyé ; tout reçu : aucun écart', () => {
    const tout = bilanReception(lignes, {
      articlesRecus: [id(100), id(101)],
      quantites: [{ ligneId: id(3), quantite: 12 }],
    });
    expect(tout.recues[2].quantite).toBe(10);
    expect(tout.ecarts).toEqual([]);
  });

  it('envoi : un téléphone à l’unité, une seule fois ; boutiques différentes', () => {
    const envoi = {
      id: id(50),
      numero: 'TR-261024-K7Q2',
      boutiqueArriveeId: id(60),
      lignes,
      note: null,
    };
    expect(schemaEnvoiTransfert.safeParse(envoi).success).toBe(true);
    expect(
      schemaEnvoiTransfert.safeParse({ ...envoi, lignes: [{ ...lignes[0], quantite: 2 }] }).success,
    ).toBe(false);
    expect(
      schemaEnvoiTransfert.safeParse({
        ...envoi,
        lignes: [lignes[0], { ...lignes[1], articleId: id(100) }],
      }).success,
    ).toBe(false);
    expect(erreurBoutiquesTransfert(id(60), id(60))).toMatch(/autre boutique/);
  });
});
