import { Test } from '@nestjs/testing';
import { SanteController } from './sante.controller.js';

describe('SanteController', () => {
  it("retourne l'état du service", async () => {
    const module = await Test.createTestingModule({
      controllers: [SanteController],
    }).compile();

    expect(module.get(SanteController).getSante()).toEqual({
      statut: 'ok',
      service: 'adil-gestventephone-api',
    });
  });
});
