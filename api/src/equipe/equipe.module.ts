import { Module } from '@nestjs/common';
import { EquipeController } from './equipe.controller.js';
import { EquipeService } from './equipe.service.js';

/** Boutiques et employés d'un commerce. */
@Module({
  controllers: [EquipeController],
  providers: [EquipeService],
})
export class EquipeModule {}
