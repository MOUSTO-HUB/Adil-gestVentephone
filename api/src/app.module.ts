import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppareilsModule } from './appareils/appareils.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BoutiquesModule } from './boutiques/boutiques.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SanteModule } from './sante/sante.module.js';
import { SecuriteModule } from './securite/securite.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    // Le .env est à la racine du monorepo ; api/.env reste possible en local.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    PrismaModule,
    SecuriteModule,
    AuditModule,
    AuthModule,
    SanteModule,
    BoutiquesModule,
    AppareilsModule,
    SyncModule,
    CatalogueModule,
  ],
})
export class AppModule {}
