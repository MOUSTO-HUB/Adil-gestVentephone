import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { BoutiqueGuard } from '../auth/guards/boutique.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { AutorisationRemiseService } from './autorisation-remise.service.js';

class DemandeAutorisationDto {
  @ApiProperty() @IsUUID() boutiqueId: string;

  @ApiProperty({ description: 'Identifiant du gérant qui valide.' })
  @IsString()
  @Length(1, 60)
  identifiant: string;

  @ApiProperty({ description: 'Code PIN du gérant.' })
  @IsString()
  @Length(4, 6)
  pin: string;

  @ApiProperty({ description: 'Remise demandée, en % du sous-total.' })
  @IsNumber()
  @Min(0)
  @Max(100)
  pourcentage: number;
}

class AutorisationDto {
  @ApiProperty({ description: 'Jeton à joindre à la vente (valable 2 heures).' }) jeton: string;
  @ApiProperty() gerant: string;
  @ApiProperty({ description: 'Remise maximale accordée (%).' }) plafond: number;
}

@ApiTags('Ventes')
@ApiBearerAuth()
@Controller('ventes')
export class VentesController {
  constructor(private readonly autorisations: AutorisationRemiseService) {}

  /**
   * Un gérant valide en personne, avec son code PIN, une remise au-delà du plafond
   * du vendeur ; le jeton renvoyé est joint à la vente (envoyée ensuite, même hors ligne).
   */
  @Post('autorisations-remise')
  @HttpCode(200)
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @UseGuards(BoutiqueGuard)
  @ApiOkResponse({ type: AutorisationDto })
  autoriser(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Body() dto: DemandeAutorisationDto,
  ): Promise<AutorisationDto> {
    return this.autorisations.autoriser(
      utilisateur,
      dto.boutiqueId,
      dto.identifiant,
      dto.pin,
      dto.pourcentage,
    );
  }
}
