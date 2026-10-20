import { Global, Module } from '@nestjs/common';
import { AutorisationRemiseService } from './autorisation-remise.service.js';
import { VentesController } from './ventes.controller.js';

/** Ventes : autorisation de remise (le service sert aussi à la synchronisation). */
@Global()
@Module({
  controllers: [VentesController],
  providers: [AutorisationRemiseService],
  exports: [AutorisationRemiseService],
})
export class VentesModule {}
