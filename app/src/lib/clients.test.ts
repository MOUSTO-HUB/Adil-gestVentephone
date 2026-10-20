import type { GarantSaisi } from '@gestvente/commun';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrer } from './base/migrations';
import type { BaseSql } from './base/sql';
import { baseEnMemoire } from './base/sql-node.test-utils';
import { clientsAvecTelephone, rechercherClients, rechercherFournisseurs } from './clients';
import { enregistrerOperation, ErreurOperation } from './sync/operations-locales';

const BOUTIQUE = '11111111-1111-4111-8111-111111111111';
let compteur = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++compteur).padStart(12, '0')}`;

const client = (surcharge: Record<string, unknown> = {}) => ({
  id: uuid(),
  nom: 'Aïssatou Bah',
  telephone: '+224623001122',
  type: 'DETAIL' as const,
  typePiece: null,
  numeroPiece: null,
  adresse: null,
  plafondCredit: null,
  archive: false,
  garant: null as GarantSaisi | null,
  ...surcharge,
});

describe('clients et fournisseurs (base locale)', () => {
  let base: BaseSql;
  beforeEach(async () => {
    base = baseEnMemoire();
    await migrer(base);
  });

  const enregistrerClient = (contenu: ReturnType<typeof client>) =>
    enregistrerOperation(base, { type: 'CLIENT_ENREGISTRER', boutiqueId: BOUTIQUE, contenu }, uuid);

  it('recherche par nom sans accents ou par chiffres du téléphone', async () => {
    await enregistrerClient(client());
    await enregistrerClient(client({ nom: 'Ousmane Barry', telephone: '+224624334455' }));
    const noms = async (terme: string) => (await rechercherClients(base, terme)).map((c) => c.nom);
    expect(await noms('aissatou')).toEqual(['Aïssatou Bah']);
    expect(await noms('624 33')).toEqual(['Ousmane Barry']);
    expect(await noms('')).toEqual(['Aïssatou Bah', 'Ousmane Barry']);
  });

  it('détecte un numéro déjà utilisé par un autre client', async () => {
    const premier = client();
    await enregistrerClient(premier);
    expect(await clientsAvecTelephone(base, '+224623001122', null)).toEqual([
      { id: premier.id, nom: 'Aïssatou Bah' },
    ]);
    expect(await clientsAvecTelephone(base, '+224623001122', premier.id)).toEqual([]);
  });

  it('remplace le garant et garde la photo de pièce déjà connue', async () => {
    const c = client({
      garant: {
        id: uuid(),
        nom: 'Garant A',
        telephone: '+224620000001',
        typePiece: null,
        numeroPiece: null,
        adresse: null,
        lien: null,
      },
    });
    await enregistrerClient(c);
    await base.executer('UPDATE client SET photoPiece = 1 WHERE id = ?', [c.id]);
    const nouveau = { ...c.garant!, id: uuid(), nom: 'Garant B' };
    await enregistrerClient({ ...c, garant: nouveau });
    expect(await base.tous('SELECT nom FROM garant')).toEqual([{ nom: 'Garant B' }]);
    expect(await base.premier('SELECT photoPiece FROM client WHERE id = ?', [c.id])).toEqual({
      photoPiece: 1,
    });
    await enregistrerClient({ ...c, garant: null });
    expect(await base.tous('SELECT nom FROM garant')).toEqual([]);
  });

  it('refuse un client invalide et un fournisseur en double', async () => {
    await expect(enregistrerClient(client({ telephone: '623001122' }))).rejects.toThrow(
      ErreurOperation,
    );
    const fournisseur = {
      id: uuid(),
      nom: 'Madina Télécom',
      telephone: null,
      adresse: null,
      note: null,
      archive: false,
    };
    await enregistrerOperation(
      base,
      { type: 'FOURNISSEUR_ENREGISTRER', boutiqueId: BOUTIQUE, contenu: fournisseur },
      uuid,
    );
    await expect(
      enregistrerOperation(
        base,
        {
          type: 'FOURNISSEUR_ENREGISTRER',
          boutiqueId: BOUTIQUE,
          contenu: { ...fournisseur, id: uuid(), nom: 'MADINA TÉLÉCOM' },
        },
        uuid,
      ),
    ).rejects.toThrow(/existe déjà/);
    expect((await rechercherFournisseurs(base, 'madina telecom')).map((f) => f.nom)).toEqual([
      'Madina Télécom',
    ]);
  });
});
