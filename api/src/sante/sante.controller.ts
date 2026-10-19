import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { NOM_APPLICATION } from '@gestvente/commun';
import { EtatSanteDto } from './sante.dto.js';

@ApiTags('Santé')
@Controller('sante')
export class SanteController {
  /** Vérifie que l'API répond (supervision, Caddy, application hors ligne). */
  @Get()
  @ApiOkResponse({ type: EtatSanteDto })
  getSante(): EtatSanteDto {
    return { statut: 'ok', service: `${NOM_APPLICATION}-api` };
  }
}
