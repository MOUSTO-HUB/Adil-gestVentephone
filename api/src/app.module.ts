import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppareilsModule } from './appareils/appareils.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BoutiquesModule } from './boutiques/boutiques.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SanteModule } from './sante/sante.module.js';
import { SecuriteModule } from './securite/securite.module.js';
import { StockModule } from './stock/stock.module.js';
import { SyncModule } from './sync/sync.module.js';
import { CaisseModule } from './caisse/caisse.module.js';
import { CreditsModule } from './credits/credits.module.js';
import { EquipeModule } from './equipe/equipe.module.js';
import { TrocsModule } from './trocs/trocs.module.js';
import { MessagesModule } from './messages/messages.module.js';
import { PlateformeModule } from './plateforme/plateforme.module.js';
import { RapportsModule } from './rapports/rapports.module.js';
import { VentesModule } from './ventes/ventes.module.js';

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
    VentesModule,
    CaisseModule,
    TrocsModule,
    CreditsModule,
    EquipeModule,
    RapportsModule,
    MessagesModule,
    PlateformeModule,
    SyncModule,
    CatalogueModule,
    ClientsModule,
    StockModule,
  ],
})
export class AppModule {}
