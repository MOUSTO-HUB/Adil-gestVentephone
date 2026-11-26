import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { CertificatsController } from '../certificats/certificats.controller.js';
import { CertificatsService } from '../certificats/certificats.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { BoutiqueGuard } from './guards/boutique.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { DebitGuard } from '../securite/debit.guard.js';
import { DUREE_ACCES } from './jetons.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_SECRET doit contenir au moins 32 caractères.');
        }
        return { secret, signOptions: { expiresIn: DUREE_ACCES } };
      },
    }),
  ],
  controllers: [AuthController, CertificatsController],
  providers: [
    AuthService,
    CertificatsService,
    BoutiqueGuard,
    // Ordre d'exécution : débit par IP, authentification, puis rôles.
    { provide: APP_GUARD, useClass: DebitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, CertificatsService, BoutiqueGuard],
})
export class AuthModule {}
