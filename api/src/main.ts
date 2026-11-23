import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurerApplication } from './app.setup.js';
import { optionsCors } from './common/cors.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurerApplication(app);
  // Origines du site (APP_ORIGIN, séparées par des virgules), cookies de l'hébergeur acceptés.
  app.enableCors(optionsCors());
  await app.listen(process.env.API_PORT ?? 3200);
}
await bootstrap();
