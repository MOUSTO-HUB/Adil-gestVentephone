import { describe, expect, it } from 'vitest';
import {
  colonnes,
  couper,
  type DocumentVente,
  etatGarantie,
  factureHtml,
  formaterDate,
  lignesRecu,
  mentionGarantie,
  recuHtml,
  resteAPayer,
  texteMessage,
} from './documents.js';
import { encoderPc850, paquets, recuEscPos, versBase64 } from './escpos.js';

const vente: DocumentVente = {
  commerce: 'Adil Phone',
  boutique: {
    nom: 'Adil Phone Madina',
    adresse: 'Marché Madina, Conakry',
    telephone: '+224620000001',
  },
  numero: 'MAD-3F2A9C-000001',
  dateVente: '2026-10-20T17:31:00.000Z',
  statut: 'VALIDEE',
  client: { nom: 'Mamadou Diallo', telephone: '+224620112233' },
  lignes: [
    {
      designation: 'Tecno Spark 20 128 Go Noir',
      imei: '352099000000014',
      quantite: 1,
      tarif: 'DETAIL',
      prixUnitaire: 1_500_000,
      total: 1_500_000,
      garantieMois: 12,
      finGarantie: '2027-10-20T17:31:00.000Z',
    },
    {
      designation: 'Coque silicone Spark 20',
      imei: null,
      quantite: 2,
      tarif: 'DETAIL',
      prixUnitaire: 30_000,
      total: 60_000,
      garantieMois: 0,
      finGarantie: null,
    },
  ],
  sousTotal: 1_560_000,
  remise: 60_000,
  reprise: 0,
  total: 1_500_000,
  montantPaye: 1_500_000,
  renduMonnaie: 100_000,
  paiements: [
    { moyen: 'ESPECES', montant: 1_000_000, reference: null },
    { moyen: 'ORANGE_MONEY', montant: 600_000, reference: 'OM123' },
  ],
  monnaie: 'GNF',
  fuseau: 'Africa/Conakry',
};

describe('garantie', () => {
  it('jours restants, expirée, sans garantie', () => {
    const fin = '2027-10-20T17:31:00.000Z';
    expect(etatGarantie(fin, new Date('2027-10-10T17:31:00.000Z'))).toEqual({
      etat: 'EN_COURS',
      fin,
      joursRestants: 10,
    });
    expect(etatGarantie(fin, new Date('2027-10-21T00:00:00.000Z'))).toEqual({
      etat: 'EXPIREE',
      fin,
    });
    expect(etatGarantie(null, new Date())).toEqual({ etat: 'SANS' });
  });

  it('mention imprimée à l’heure de la boutique', () => {
    expect(mentionGarantie(vente.lignes[0]!, vente.fuseau)).toBe(
      "Garantie 12 mois, jusqu'au 20/10/2027",
    );
    expect(mentionGarantie(vente.lignes[1]!, vente.fuseau)).toBeNull();
    expect(formaterDate(vente.dateVente, 'Africa/Conakry', true)).toBe('20/10/2026 17:31');
  });
});

describe('reçu thermique', () => {
  it('coupe les textes longs et aligne les montants', () => {
    expect(couper('Écouteurs Bluetooth sans fil Oraimo FreePods 4', 16)).toEqual([
      'Écouteurs',
      'Bluetooth sans',
      'fil Oraimo',
      'FreePods 4',
    ]);
    expect(couper('123456789012', 5)).toEqual(['12345', '67890', '12']);
    expect(colonnes('TOTAL', '1 500 000 GNF', 32)).toHaveLength(32);
    expect(colonnes('Un libellé bien trop long pour la ligne', '10 GNF', 20)).toHaveLength(20);
  });

  it.each([58, 80] as const)('aucune ligne ne dépasse la largeur du papier (%i mm)', (largeur) => {
    const lignes = lignesRecu(vente, largeur);
    const max = largeur === 58 ? 32 : 48;
    expect(Math.max(...lignes.map((l) => l.texte.length))).toBeLessThanOrEqual(max);
    const textes = lignes.map((l) => l.texte).join('\n');
    expect(textes).toContain('IMEI 352099000000014');
    expect(textes).toContain("Garantie 12 mois, jusqu'au");
    expect(textes).toContain('Réf. OM123');
    expect(textes).toMatch(/Monnaie rendue +100 000 GNF/);
    expect(textes).not.toContain('Reste à payer');
    expect(lignes.find((l) => l.texte.startsWith('TOTAL'))?.gras).toBe(true);
  });

  it('reste à payer et vente annulée', () => {
    const credit = { ...vente, montantPaye: 500_000, renduMonnaie: 0 };
    expect(resteAPayer(credit)).toBe(1_000_000);
    expect(lignesRecu(credit, 58).map((l) => l.texte)).toContain(
      colonnes('Reste à payer', '1 000 000 GNF', 32),
    );
    expect(
      lignesRecu({ ...vente, statut: 'ANNULEE' }, 80).some((l) => l.texte.includes('ANNULÉE')),
    ).toBe(true);
  });
});

describe('HTML et message', () => {
  it('facture A4 échappée, avec IMEI, garantie et totaux', () => {
    const html = factureHtml({ ...vente, client: { nom: 'Ali <b>', telephone: null } });
    expect(html).toContain('size: A4');
    expect(html).toContain('Ali &lt;b&gt;');
    expect(html).not.toContain('Ali <b>');
    expect(html).toContain('IMEI 352099000000014');
    expect(html).toContain('Remise');
    expect(html).toContain('réf. OM123');
  });

  it('reçu HTML au format du papier', () => {
    expect(recuHtml(vente, 58)).toContain('size: 58mm auto');
    expect(recuHtml(vente, 80)).toContain('size: 80mm auto');
  });

  it('texte WhatsApp / SMS', () => {
    const texte = texteMessage(vente);
    expect(texte).toContain('Facture MAD-3F2A9C-000001 du 20/10/2026');
    expect(texte).toContain('1 x Tecno Spark 20 128 Go Noir (IMEI 352099000000014)');
    expect(texte).toContain('Total : 1 500 000 GNF');
  });
});

describe('ESC/POS', () => {
  it('accents en PC850, autres caractères simplifiés', () => {
    expect(encoderPc850('Éé àç')).toEqual([0x90, 0x82, 0x20, 0x85, 0x87]);
    expect(encoderPc850('l’œuf – ñ ã ☺')).toEqual([
      ...[..."l'oeuf - "].map((c) => c.charCodeAt(0)),
      0xa4,
      0x20,
      0x61,
      0x20,
      0x3f,
    ]);
  });

  it('initialise, aligne, met en gras puis coupe', () => {
    const octets = recuEscPos([{ texte: 'ADIL', centre: true, gras: true }, { texte: 'Reçu' }]);
    expect(Array.from(octets.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 2]);
    expect(Array.from(octets.slice(5, 11))).toEqual([0x1b, 0x61, 1, 0x1b, 0x45, 1]);
    expect(Array.from(octets.slice(-4))).toEqual([0x1d, 0x56, 66, 0]);
    expect([...octets]).toContain(0x87);
  });

  it('paquets et base64', () => {
    const octets = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(paquets(octets, 2).map((p) => [...p])).toEqual([[1, 2], [3, 4], [5]]);
    const attendus = ['', '+g==', '+gA=', '+gBC', '+gBCBw==', '+gBCB4A='];
    attendus.forEach((attendu, n) =>
      expect(versBase64(Uint8Array.from([250, 0, 66, 7, 128].slice(0, n)))).toBe(attendu),
    );
  });
});
