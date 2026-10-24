import type { INestApplication } from '@nestjs/common';
import { MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import type { App } from 'supertest/types.js';
import { CLE_PUBLIC, CLE_ROLES } from '../src/auth/decorateurs.js';
import { demarrerApplication } from './outils.js';

/**
 * Routes publiques mais gardées autrement (justification obligatoire) : l'espace du
 * concepteur a son propre jeton, vérifié par ConcepteurGuard.
 */
const GARDEES_AUTREMENT: Record<string, string> = {
  PlateformeController: 'jeton du concepteur (ConcepteurGuard), jamais celui d’un commerçant',
};

/**
 * Contrôle d'accès de chaque route : toute méthode de contrôleur porte @Roles(...)
 * (rôles explicites) ou @Public() ; aucune n'est ouverte « par défaut » à tout
 * utilisateur connecté.
 */
describe('Rôles exigés sur chaque route (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await demarrerApplication();
  });

  afterAll(async () => {
    await app.close();
  });

  it('chaque route déclare ses rôles (ou est publique et justifiée)', () => {
    const modules = app.get(ModulesContainer);
    const scanner = new MetadataScanner();
    const reflecteur = new Reflector();
    const controleurs = [...modules.values()].flatMap((m) => [...m.controllers.values()]);
    const sansRole: string[] = [];
    let routes = 0;
    for (const wrapper of controleurs) {
      const instance = wrapper.instance as object | undefined;
      if (!instance || !wrapper.metatype) continue;
      const classe = wrapper.metatype as new (...args: unknown[]) => unknown;
      for (const nom of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const methode = (instance as Record<string, unknown>)[nom] as () => unknown;
        if (reflecteur.get(PATH_METADATA, methode) === undefined) continue;
        routes++;
        const cibles = [methode, classe];
        const publique = reflecteur.getAllAndOverride<boolean>(CLE_PUBLIC, cibles);
        const roles = reflecteur.getAllAndOverride<string[]>(CLE_ROLES, cibles);
        if (publique && classe.name in GARDEES_AUTREMENT) continue;
        if (publique || (roles && roles.length > 0)) continue;
        sansRole.push(`${classe.name}.${nom}`);
      }
    }
    expect(routes).toBeGreaterThan(50);
    expect(sansRole).toEqual([]);
  });
});
