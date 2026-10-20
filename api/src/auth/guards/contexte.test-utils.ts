import type { ExecutionContext } from '@nestjs/common';
import type { RequeteAuthentifiee } from '../auth.types.js';

/**
 * Construit un ExecutionContext HTTP minimal pour tester un garde.
 * `classe` et `methode` désignent la route dont les décorateurs (@Public, @Roles…) sont lus.
 */
export function contexteHttp(
  requete: Partial<RequeteAuthentifiee>,
  classe: new () => object = class {},
  methode?: string,
): ExecutionContext {
  const req = { headers: {}, params: {}, query: {}, body: {}, ...requete };
  const handler: unknown = methode ? Reflect.get(classe.prototype as object, methode) : () => {};
  return {
    getHandler: () => handler,
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
