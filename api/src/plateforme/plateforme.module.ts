import { Module } from '@nestjs/common';
import { ConcepteurGuard } from './concepteur.guard.js';
import { PlateformeController } from './plateforme.controller.js';
import { PlateformeService } from './plateforme.service.js';

/** Espace concepteur : gestion des commerces abonnés à la plateforme. */
@Module({
  controllers: [PlateformeController],
  providers: [PlateformeService, ConcepteurGuard],
})
export class PlateformeModule {}
