import { Module } from '@nestjs/common';
import { AideConnexionController, DemandesMotDePasseController } from './aide.controller.js';
import { AideConnexionService } from './aide.service.js';
import { AppareilsPlateformeController } from './appareils-plateforme.controller.js';
import { ComptesConcepteurController } from './comptes.controller.js';
import { ComptesConcepteurService } from './comptes.service.js';
import { ConcepteurGuard } from './concepteur.guard.js';
import { PlateformeController } from './plateforme.controller.js';
import { PlateformeService } from './plateforme.service.js';

/** Espace concepteur : gestion des commerces abonnés à la plateforme. */
@Module({
  controllers: [
    PlateformeController,
    ComptesConcepteurController,
    AideConnexionController,
    DemandesMotDePasseController,
    AppareilsPlateformeController,
  ],
  providers: [PlateformeService, ComptesConcepteurService, ConcepteurGuard, AideConnexionService],
})
export class PlateformeModule {}
