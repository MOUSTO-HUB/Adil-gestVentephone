import { describe, expect, it } from 'vitest';
import { migrer } from './base/migrations';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { enregistrerOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

describe('envoi de la facture au client (base locale)', () => {
  it('mis en file sans rien écrire ; refusé sans numéro ou pour une vente inconnue', async () => {
    const base = baseEnMemoire();
    await migrer(base);
    const venteId = uuid();
    await base.executer(
      `INSERT INTO vente (id, boutiqueId, numero, vendeurId, mode, statut, sousTotal, remise, total,
         montantPaye, renduMonnaie, dateVente) VALUES (?, ?, 'MAD-1', 'u', 'COMPTANT', 'VALIDEE',
         30000, 0, 30000, 30000, 0, '2026-10-21T10:00:00.000Z')`,
      [venteId, BOUTIQUE],
    );
    const envoi = (id: string, telephone: string | null) =>
      enregistrerOperation(
        base,
        {
          type: 'MESSAGE_ENVOYER',
          boutiqueId: BOUTIQUE,
          contenu: { id: uuid(), venteId: id, type: 'FACTURE', canal: 'SMS', telephone },
        },
        uuid,
      );
    await expect(envoi(venteId, null)).rejects.toThrow(/Aucun numéro/);
    await expect(envoi(uuid(), '+224620112233')).rejects.toThrow(/introuvable/);
    await envoi(venteId, '+224620112233');
    expect(await base.tous('SELECT type FROM operation')).toEqual([{ type: 'MESSAGE_ENVOYER' }]);
  });
});
