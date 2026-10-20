import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { AppareilDto, ResultatDeconnexionDto } from './appareils.dto.js';
import { AppareilsService } from './appareils.service.js';

@ApiTags('Appareils')
@ApiBearerAuth()
@Roles(Role.PROPRIETAIRE, Role.GERANT)
@Controller()
export class AppareilsController {
  constructor(private readonly appareils: AppareilsService) {}

  /** Appareils connectés : tous pour le propriétaire, ceux des vendeurs de ses boutiques pour un gérant. */
  @Get('appareils')
  @ApiOkResponse({ type: [AppareilDto] })
  lister(@UtilisateurCourant() acteur: UtilisateurConnecte): Promise<AppareilDto[]> {
    return this.appareils.lister(acteur);
  }

  /** Déconnecte un appareil à distance (perdu, volé, prêté). */
  @Post('appareils/:id/deconnexion')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'Appareil d’une personne que vous ne gérez pas.' })
  deconnecterAppareil(
    @UtilisateurCourant() acteur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.appareils.deconnecterAppareil(acteur, id);
  }

  /** Déconnecte tous les appareils d'un employé. */
  @Post('utilisateurs/:id/deconnexion')
  @HttpCode(200)
  @ApiOkResponse({ type: ResultatDeconnexionDto })
  @ApiForbiddenResponse({ description: 'Personne que vous ne gérez pas.' })
  deconnecterUtilisateur(
    @UtilisateurCourant() acteur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResultatDeconnexionDto> {
    return this.appareils.deconnecterUtilisateur(acteur, id);
  }
}
