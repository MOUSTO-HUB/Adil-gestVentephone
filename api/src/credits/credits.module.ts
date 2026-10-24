import { Module } from '@nestjs/common';
import { CreditsController } from './credits.controller.js';
import { RappelsService } from './rappels.service.js';

/** Crédits : rappels quotidiens des tranches, pénalités, relance manuelle. */
@Module({
  controllers: [CreditsController],
  providers: [RappelsService],
  exports: [RappelsService],
})
export class CreditsModule {}
