import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { schemaParametresRappels, TYPES_PENALITE, type TypePenalite } from '@gestvente/commun';
import { IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { RappelsService } from './rappels.service.js';

class ParametresRappelsDto {
  @ApiProperty({ description: 'Rappel N jours avant l’échéance (0 : aucun).' })
  @IsInt()
  @Min(0)
  @Max(30)
  joursAvant: number;

  @ApiProperty({ description: 'Relances de retard au plus par tranche (une tous les 7 jours).' })
  @IsInt()
  @Min(0)
  @Max(20)
  relancesMax: number;

  @ApiProperty({ enum: ['SMS', 'WHATSAPP'] }) @IsIn(['SMS', 'WHATSAPP']) canal: 'SMS' | 'WHATSAPP';

  @ApiProperty() @IsBoolean() penaliteActive: boolean;

  @ApiProperty({ enum: TYPES_PENALITE }) @IsIn(TYPES_PENALITE) penaliteType: TypePenalite;

  @ApiProperty({ description: 'Montant fixe, ou pourcentage de la tranche.' })
  @IsInt()
  @Min(0)
  penaliteValeur: number;

  @ApiProperty({ description: 'Jours de retard tolérés avant la pénalité.' })
  @IsInt()
  @Min(0)
  @Max(90)
  penaliteGrace: number;
}

class RelanceDto {
  @ApiProperty({ enum: ['AVANT', 'JOUR', 'RETARD'] }) type: string;
  @ApiProperty() montant: number;
  @ApiProperty({ enum: ['SMS', 'WHATSAPP'] }) canal: string;
}

/** Rappels des tranches de crédit et pénalités de retard. */
@ApiTags('Crédits')
@ApiBearerAuth()
@Controller('credits')
export class CreditsController {
  constructor(private readonly rappels: RappelsService) {}

  @Get('parametres')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ type: ParametresRappelsDto })
  parametres(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.rappels.parametres(u.commerceId);
  }

  /** Réglages des rappels et de la pénalité (propriétaire). */
  @Put('parametres')
  @Roles(Role.PROPRIETAIRE)
  @ApiOkResponse({ type: ParametresRappelsDto })
  modifier(@UtilisateurCourant() u: UtilisateurConnecte, @Body() dto: ParametresRappelsDto) {
    const controle = schemaParametresRappels.safeParse(dto);
    if (!controle.success) {
      throw new BadRequestException(controle.error.issues.map((i) => i.message).join(' '));
    }
    return this.rappels.modifierParametres(u, controle.data);
  }

  /** « Relancer maintenant » : message au client (montant échu, sinon prochaine tranche). */
  @Post(':id/relancer')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(200)
  @ApiOkResponse({ type: RelanceDto })
  relancer(@UtilisateurCourant() u: UtilisateurConnecte, @Param('id', ParseUUIDPipe) id: string) {
    return this.rappels.relancer(u, id);
  }
}
