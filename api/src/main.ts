import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurerApplication } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurerApplication(app);
  // Une ou plusieurs origines séparées par des virgules (version web de l'application).
  const origines = (process.env.APP_ORIGIN ?? 'http://localhost:8081')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origines });
  await app.listen(process.env.API_PORT ?? 3200);
}
await bootstrap();
