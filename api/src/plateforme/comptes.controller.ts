import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsString, Length, Matches } from 'class-validator';
import { Public } from '../auth/decorateurs.js';
import { ComptesConcepteurService } from './comptes.service.js';
import { ConcepteurCourant, type ConcepteurConnecte, ConcepteurGuard } from './concepteur.guard.js';

class NouveauConcepteurDto {
  @ApiProperty({ example: 'Aïssata Camara' }) @IsString() @Length(2, 80) nom: string;
  @ApiProperty({ example: 'aissata' })
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, {
    message: 'Identifiant : 3 à 40 caractères (lettres, chiffres, . _ -).',
  })
  identifiant: string;
}

class ActivationDto {
  @ApiProperty() @IsBoolean() actif: boolean;
}

class RecuperationDto {
  @ApiProperty({ description: 'Retirer aussi sa double authentification (téléphone perdu).' })
  @IsBoolean()
  retirerDoubleAuth: boolean;
}

class MotDePasseDto {
  @ApiProperty() @IsString() @Length(1, 200) actuel: string;
  @ApiProperty() @IsString() @Length(1, 200) nouveau: string;
}

class CodeDto {
  @ApiProperty({ example: '123456', description: 'Code à 6 chiffres de l’application.' })
  @Matches(/^\d{6}$/, { message: 'Le code comporte 6 chiffres.' })
  code: string;
}

/**
 * Comptes des concepteurs et « Mon compte » (mot de passe, double authentification).
 * Routes @Public() pour le garde des commerçants, protégées par ConcepteurGuard.
 */
@ApiTags('Plateforme (concepteur)')
@ApiBearerAuth()
@Public()
@UseGuards(ConcepteurGuard)
@Controller('plateforme')
export class ComptesConcepteurController {
  constructor(private readonly comptes: ComptesConcepteurService) {}

  @Get('concepteurs')
  liste(@ConcepteurCourant() moi: ConcepteurConnecte) {
    return this.comptes.liste(moi);
  }

  @Post('concepteurs')
  @ApiOkResponse({
    description: 'Mot de passe provisoire du nouveau concepteur, affiché une fois.',
  })
  creer(@ConcepteurCourant() moi: ConcepteurConnecte, @Body() dto: NouveauConcepteurDto) {
    return this.comptes.creer(moi, dto.nom, dto.identifiant);
  }

  @Patch('concepteurs/:id')
  @HttpCode(204)
  async activation(
    @ConcepteurCourant() moi: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivationDto,
  ): Promise<void> {
    await this.comptes.changerActivation(moi, id, dto.actif);
  }

  @Post('concepteurs/:id/recuperation')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Nouveau mot de passe provisoire, affiché une fois.' })
  recuperation(
    @ConcepteurCourant() moi: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecuperationDto,
  ) {
    return this.comptes.recuperation(moi, id, dto.retirerDoubleAuth);
  }

  @Delete('concepteurs/:id')
  @HttpCode(204)
  async supprimer(
    @ConcepteurCourant() moi: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.comptes.supprimer(moi, id);
  }

  @Get('moi')
  monCompte(@ConcepteurCourant() moi: ConcepteurConnecte) {
    return this.comptes.monCompte(moi);
  }

  @Put('moi/mot-de-passe')
  @HttpCode(204)
  async motDePasse(
    @ConcepteurCourant() moi: ConcepteurConnecte,
    @Body() dto: MotDePasseDto,
  ): Promise<void> {
    await this.comptes.changerMotDePasse(moi, dto.actuel, dto.nouveau);
  }

  @Post('moi/double-auth/preparer')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Secret et QR code à scanner avec l’application.' })
  preparer(@ConcepteurCourant() moi: ConcepteurConnecte) {
    return this.comptes.preparerDoubleAuth(moi);
  }

  @Post('moi/double-auth/activer')
  @HttpCode(204)
  async activer(@ConcepteurCourant() moi: ConcepteurConnecte, @Body() dto: CodeDto): Promise<void> {
    await this.comptes.activerDoubleAuth(moi, dto.code);
  }

  @Post('moi/double-auth/desactiver')
  @HttpCode(204)
  async desactiver(
    @ConcepteurCourant() moi: ConcepteurConnecte,
    @Body() dto: CodeDto,
  ): Promise<void> {
    await this.comptes.desactiverDoubleAuth(moi, dto.code);
  }
}
