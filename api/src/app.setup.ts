import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { convertirBigIntEnJson } from './common/bigint.js';

/** Configuration commune à main.ts et aux tests e2e. */
export function configurerApplication(app: INestApplication): void {
  convertirBigIntEnJson();
  const express = app as NestExpressApplication;
  // Seuls les relais du réseau local ou privé (Caddy) sont crus pour X-Forwarded-For.
  express.set('trust proxy', 'loopback, uniquelocal');
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Documentation OpenAPI : /api/docs (page) et /api/docs-json (fichier).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Adil-gestVentephone')
      .setDescription('API de gestion de vente de téléphones et d’accessoires')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  // En-têtes de sécurité ; la page de documentation a besoin de ses styles et scripts.
  const entetesSecurite = helmet({
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  express.use((req: Request, res: Response, next: NextFunction) =>
    req.path.startsWith('/api/docs') ? next() : entetesSecurite(req, res, next),
  );
}
