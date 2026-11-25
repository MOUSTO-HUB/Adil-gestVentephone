import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { Public } from '../auth/decorateurs.js';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';
import { AideConnexionService } from './aide.service.js';
import { ConcepteurCourant, type ConcepteurConnecte, ConcepteurGuard } from './concepteur.guard.js';

class DemandeMotDePasseDto {
  @ApiProperty({ example: 'abdoul' }) @IsString() @Length(1, 60) identifiant: string;
  @ApiPropertyOptional({ example: '+224620112233', description: 'Numéro pour être rappelé.' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^[+0-9 ().-]{6,25}$/, { message: 'Numéro de téléphone invalide.' })
  contact?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) message?: string | null;
}

class ContactDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 80) nom: string | null;
  @ApiPropertyOptional({ example: '+224620000000' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^[+0-9 ().-]{6,25}$/, { message: 'Téléphone invalide.' })
  telephone: string | null;
  @ApiPropertyOptional({ example: '+224620000000' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(/^[+0-9 ().-]{6,25}$/, { message: 'Numéro WhatsApp invalide.' })
  whatsapp: string | null;
  @ApiPropertyOptional({ example: 'contact@exemple.com' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email: string | null;
}

/** Routes publiques de l'écran de connexion des commerçants. */
@ApiTags('Aide à la connexion')
@Controller('aide')
export class AideConnexionController {
  constructor(
    private readonly aide: AideConnexionService,
    private readonly limiteur: LimiteurService,
  ) {}

  @Get('contact')
  @Public()
  @ApiOkResponse({ description: 'Contact du concepteur (téléphone, WhatsApp, e-mail).' })
  contact() {
    return this.aide.contact();
  }

  @Post('mot-de-passe-oublie')
  @Public()
  @HttpCode(202)
  @ApiAcceptedResponse({
    description: 'Demande transmise au concepteur (même réponse si le compte est inconnu).',
  })
  @ApiTooManyRequestsResponse({ description: 'Trop de demandes depuis cette connexion.' })
  async demander(@Body() dto: DemandeMotDePasseDto, @Ip() ip: string) {
    await this.limiteur.verifier(LIMITES.motDePasseOublie, ip);
    return this.aide.demander(dto.identifiant, dto.contact ?? null, dto.message ?? null);
  }
}

/** Espace concepteur : demandes « Mot de passe oublié » et contact affiché aux commerçants. */
@ApiTags('Plateforme (concepteur)')
@Public()
@UseGuards(ConcepteurGuard)
@ApiBearerAuth()
@Controller('plateforme')
export class DemandesMotDePasseController {
  constructor(private readonly aide: AideConnexionService) {}

  @Get('demandes')
  demandes() {
    return this.aide.demandes();
  }

  @Get('demandes/compte')
  @ApiOkResponse({ description: 'Nombre de demandes en attente (pastille de l’onglet).' })
  compte() {
    return this.aide.nombreEnAttente();
  }

  @Post('demandes/:id/mot-de-passe')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Nouveau mot de passe provisoire, affiché une fois.' })
  motDePasse(@ConcepteurCourant() c: ConcepteurConnecte, @Param('id', ParseUUIDPipe) id: string) {
    return this.aide.nouveauMotDePasse(c, id);
  }

  @Post('demandes/:id/ignorer')
  @HttpCode(204)
  async ignorer(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.aide.ignorer(c, id);
  }

  @Get('contact')
  contact() {
    return this.aide.contact();
  }

  @Put('contact')
  modifierContact(@Body() dto: ContactDto) {
    return this.aide.modifierContact({
      nom: dto.nom ?? null,
      telephone: dto.telephone ?? null,
      whatsapp: dto.whatsapp ?? null,
      email: dto.email ?? null,
    });
  }
}
