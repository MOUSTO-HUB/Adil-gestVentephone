import { describe, expect, it } from 'vitest';
import { MESSAGES, messageClair, messageStatut, texteClair } from './erreurs';

describe('texteClair', () => {
  it('garde une phrase française', () => {
    expect(texteClair('Identifiant ou mot de passe incorrect.')).toBe(
      'Identifiant ou mot de passe incorrect.',
    );
    expect(texteClair('Caisse fermée : ouvrez-la avant de vendre.')).toBe(
      'Caisse fermée : ouvrez-la avant de vendre.',
    );
  });

  it('traduit les erreurs de la base locale', () => {
    expect(
      texteClair(
        "Error: Aborted(SyntaxError: Failed to execute 'open' on 'XMLHttpRequest': Invalid URL).",
      ),
    ).toBe(MESSAGES.baseLocale);
    expect(texteClair('Error: Invalid VFS state')).toBe(MESSAGES.baseLocale);
    expect(
      texteClair("NoModificationAllowedError: Failed to execute 'createSyncAccessHandle'"),
    ).toBe(MESSAGES.baseLocale);
  });

  it('traduit les coupures réseau', () => {
    expect(texteClair('TypeError: Failed to fetch')).toBe(MESSAGES.reseau);
    expect(texteClair('Network request failed')).toBe(MESSAGES.reseau);
    expect(texteClair('Serveur injoignable. Vérifiez la connexion Internet.')).toBe(
      MESSAGES.reseau,
    );
  });

  it('remplace tout texte technique ou numéro d’erreur', () => {
    expect(texteClair('identifiant must be longer than or equal to 1 characters')).toBe(
      MESSAGES.inattendue,
    );
    expect(texteClair('Erreur 500')).toBe(MESSAGES.inattendue);
    expect(texteClair('Cannot read properties of undefined')).toBe(MESSAGES.inattendue);
    expect(texteClair('')).toBe(MESSAGES.inattendue);
  });
});

describe('messageClair', () => {
  it('erreur de l’API : phrase du serveur, sinon phrase selon le code', () => {
    expect(messageClair({ statut: 401, message: 'Identifiant ou mot de passe incorrect.' })).toBe(
      'Identifiant ou mot de passe incorrect.',
    );
    expect(messageClair({ statut: 400, message: 'motDePasse must be a string' })).toBe(
      MESSAGES.saisie,
    );
    expect(messageClair({ statut: 503, message: 'Erreur 503' })).toBe(MESSAGES.serveur);
    expect(messageClair({ statut: 429, message: 'Too Many Requests' })).toBe(MESSAGES.tentatives);
  });

  it('exceptions et valeurs quelconques', () => {
    expect(messageClair(new Error('Failed to fetch'))).toBe(MESSAGES.reseau);
    expect(messageClair('Stock insuffisant pour ce produit.')).toBe(
      'Stock insuffisant pour ce produit.',
    );
    expect(messageClair(42)).toBe(MESSAGES.inattendue);
  });

  it('codes HTTP', () => {
    expect(messageStatut(403)).toBe(MESSAGES.interdit);
    expect(messageStatut(404)).toBe(MESSAGES.introuvable);
    expect(messageStatut(418)).toBe(MESSAGES.inattendue);
  });
});
