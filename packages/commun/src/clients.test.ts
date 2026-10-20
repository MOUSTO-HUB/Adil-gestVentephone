import {
  erreurDroitsClient,
  schemaClient,
  schemaFournisseur,
  texteRechercheClient,
} from './clients.js';
import { formaterTelephone, normaliserTelephone } from './telephone.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('téléphones', () => {
  it('ajoute l’indicatif du commerce aux numéros saisis sans', () => {
    expect(normaliserTelephone('620 11 22 33')).toBe('+224620112233');
    expect(normaliserTelephone('07 08 09 10 11', '+225')).toBe('+2250708091011');
  });

  it('garde un numéro international et convertit 00 en +', () => {
    expect(normaliserTelephone('+221 77 123 45 67')).toBe('+221771234567');
    expect(normaliserTelephone('00224-620-11-22-33')).toBe('+224620112233');
  });

  it('refuse un numéro trop court, avec des lettres ou vide', () => {
    expect(normaliserTelephone('123')).toBeNull();
    expect(normaliserTelephone('62O112233')).toBeNull();
    expect(normaliserTelephone('  ')).toBeNull();
  });

  it('affiche un numéro lisible', () => {
    expect(formaterTelephone('+224620112233')).toBe('+224 620 11 22 33');
    expect(formaterTelephone('+33612345678')).toBe('+33612345678');
  });
});

const client = {
  id: ID,
  nom: 'Mamadou Diallo',
  telephone: '+224620112233',
  type: 'DETAIL' as const,
  typePiece: 'CNI' as const,
  numeroPiece: 'GN-123',
  adresse: 'Madina',
  plafondCredit: 2_000_000,
  archive: false,
  garant: null,
};

describe('schemaClient', () => {
  it('accepte un client complet ou minimal', () => {
    expect(schemaClient.safeParse(client).success).toBe(true);
    expect(
      schemaClient.safeParse({
        ...client,
        typePiece: null,
        numeroPiece: null,
        adresse: null,
        plafondCredit: null,
      }).success,
    ).toBe(true);
  });

  it('refuse un téléphone non international, un numéro de pièce sans type', () => {
    expect(schemaClient.safeParse({ ...client, telephone: '620112233' }).success).toBe(false);
    expect(schemaClient.safeParse({ ...client, typePiece: null }).success).toBe(false);
  });

  it('valide le garant', () => {
    const garant = {
      id: ID,
      nom: 'Fatou',
      telephone: '+224621000000',
      typePiece: null,
      numeroPiece: null,
      adresse: null,
      lien: 'Sœur',
    };
    expect(schemaClient.safeParse({ ...client, garant }).success).toBe(true);
    expect(
      schemaClient.safeParse({ ...client, garant: { ...garant, telephone: 'x' } }).success,
    ).toBe(false);
  });
});

describe('schemaFournisseur', () => {
  it('téléphone facultatif mais valide', () => {
    const f = {
      id: ID,
      nom: 'Dubaï Phones',
      telephone: null,
      adresse: null,
      note: null,
      archive: false,
    };
    expect(schemaFournisseur.safeParse(f).success).toBe(true);
    expect(schemaFournisseur.safeParse({ ...f, telephone: '+971501234567' }).success).toBe(true);
    expect(schemaFournisseur.safeParse({ ...f, telephone: 'abc' }).success).toBe(false);
  });
});

describe('erreurDroitsClient', () => {
  const detail = { plafondCredit: null, type: 'DETAIL' as const };

  it('tout le personnel crée un client de détail sans plafond', () => {
    expect(erreurDroitsClient('VENDEUR', null, detail)).toBeNull();
  });

  it('seul le propriétaire fixe ou change le plafond', () => {
    const avecPlafond = { ...detail, plafondCredit: 1_000_000 };
    expect(erreurDroitsClient('GERANT', null, avecPlafond)).toMatch(/propriétaire/);
    expect(erreurDroitsClient('PROPRIETAIRE', null, avecPlafond)).toBeNull();
    // Le vendeur modifie l'adresse d'un client qui a déjà un plafond : permis.
    expect(erreurDroitsClient('VENDEUR', avecPlafond, avecPlafond)).toBeNull();
  });

  it('seuls propriétaire et gérants classent un client grossiste', () => {
    const grossiste = { ...detail, type: 'GROSSISTE' as const };
    expect(erreurDroitsClient('VENDEUR', null, grossiste)).toMatch(/grossiste/);
    expect(erreurDroitsClient('GERANT', detail, grossiste)).toBeNull();
    expect(erreurDroitsClient('VENDEUR', grossiste, detail)).toMatch(/grossiste/);
  });
});

describe('texteRechercheClient', () => {
  it('nom sans accents et chiffres du téléphone', () => {
    expect(texteRechercheClient({ nom: 'Aïssatou Bah', telephone: '+224623001122' })).toBe(
      'aissatou bah 224623001122',
    );
  });
});
