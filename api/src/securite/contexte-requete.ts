import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** Informations de la requête en cours, lisibles partout (ex. IP pour l'audit). */
const contexte = new AsyncLocalStorage<{ ip?: string }>();

export const ipRequete = () => contexte.getStore()?.ip;

export function memoriserRequete(req: Request, _res: Response, next: NextFunction) {
  contexte.run({ ip: req.ip }, next);
}
