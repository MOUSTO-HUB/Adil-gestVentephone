import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configurerApplication } from '../src/app.setup.js';

describe('Santé (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configurerApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/sante', () =>
    request(app.getHttpServer())
      .get('/api/sante')
      .expect(200)
      .expect({ statut: 'ok', service: 'adil-gestventephone-api' }));

  it('GET /api/docs-json publie la documentation OpenAPI', async () => {
    const reponse = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(reponse.body.paths).toHaveProperty('/api/sante');
  });
});
