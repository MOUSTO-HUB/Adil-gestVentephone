import { describe, expect, it } from 'vitest';
import {
  CANAUX_MESSAGE,
  erreurModele,
  EXEMPLE_VARIABLES,
  LONGUEUR_SMS,
  MODELES_PAR_DEFAUT,
  PARAMETRES_WHATSAPP,
  remplir,
  texteSms,
  TYPES_MESSAGE,
} from './messages.js';

describe('modèles de messages', () => {
  it('remplace les variables, vide les absentes, resserre les espaces', () => {
    expect(
      remplir('Bonjour {client}, {montant} {monnaie}.', {
        client: 'Awa',
        montant: '30 000',
        monnaie: 'GNF',
      }),
    ).toBe('Bonjour Awa, 30 000 GNF.');
    expect(remplir('{boutique} : {client} !', { boutique: 'Madina' })).toBe('Madina : !');
  });

  it('les textes par défaut sont valides et tiennent dans un SMS', () => {
    for (const type of TYPES_MESSAGE) {
      for (const canal of CANAUX_MESSAGE) {
        expect(erreurModele(MODELES_PAR_DEFAUT[type][canal], canal)).toBeNull();
      }
      expect(remplir(MODELES_PAR_DEFAUT[type].SMS, EXEMPLE_VARIABLES).length).toBeLessThanOrEqual(
        LONGUEUR_SMS,
      );
      // Chaque variable du texte WhatsApp est un paramètre du modèle approuvé.
      const variables = [...MODELES_PAR_DEFAUT[type].WHATSAPP.matchAll(/\{(\w+)\}/g)].map(
        (m) => m[1],
      );
      expect(new Set(variables)).toEqual(new Set(PARAMETRES_WHATSAPP[type]));
    }
  });

  it('refuse une variable inconnue et un SMS trop long', () => {
    expect(erreurModele('Bonjour {nom}', 'SMS')).toMatch(/Variable inconnue : \{nom\}/);
    expect(erreurModele('   ', 'SMS')).toMatch(/vide/);
    const long = `{boutique} : ${'x'.repeat(150)} {lien}`;
    expect(erreurModele(long, 'SMS')).toMatch(/Trop long pour un SMS/);
    expect(erreurModele(long, 'WHATSAPP')).toBeNull();
  });

  it('SMS trop long à l’envoi : noms raccourcis, puis texte coupé en gardant le lien', () => {
    const lien = 'https://g.exemple.com/api/f/Ab3dE9xK2q';
    const court = texteSms('{boutique} : merci {client} ! {lien}', {
      boutique: 'Adil Phone Madina Grand Marché',
      client: 'Mamadou Saliou Diallo',
      lien,
    });
    expect(court.length).toBeLessThanOrEqual(LONGUEUR_SMS);
    const coupe = texteSms(`${'Très long message. '.repeat(10)}{lien}`, { lien });
    expect(coupe.length).toBeLessThanOrEqual(LONGUEUR_SMS);
    expect(coupe.endsWith(lien)).toBe(true);
    expect(texteSms('x'.repeat(200), {})).toHaveLength(LONGUEUR_SMS);
  });
});
