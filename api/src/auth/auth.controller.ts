import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';
import {
  ConnexionDto,
  DefinirPinDto,
  ProfilDto,
  RafraichissementDto,
  ResultatPinDto,
  SessionDto,
  VerifierPinDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { UtilisateurConnecte } from './auth.types.js';
import { Public, UtilisateurCourant } from './decorateurs.js';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly limiteur: LimiteurService,
  ) {}

  /** Connexion par identifiant et mot de passe ; crée la session de l'appareil. */
  @Public()
  @Post('connexion')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'Identifiant ou mot de passe incorrect.' })
  @ApiTooManyRequestsResponse({ description: 'Trop de tentatives.' })
  async connexion(@Body() dto: ConnexionDto, @Ip() ip: string): Promise<SessionDto> {
    // Plusieurs appareils d'une boutique partagent souvent une IP : seuls les échecs comptent.
    await this.limiteur.controler(LIMITES.connexionIp, ip);
    try {
      return await this.auth.connexion(dto.identifiant, dto.motDePasse, dto.appareil);
    } catch (erreur) {
      if (erreur instanceof UnauthorizedException) {
        await this.limiteur.verifier(LIMITES.connexionIp, ip);
      }
      throw erreur;
    }
  }

  /** Nouveau couple de jetons ; le jeton présenté devient inutilisable. */
  @Public()
  @Post('rafraichir')
  @HttpCode(200)
  @ApiOkResponse({ type: SessionDto })
  @ApiUnauthorizedResponse({ description: 'Session expirée, fermée ou jeton déjà utilisé.' })
  rafraichir(@Body() dto: RafraichissementDto): Promise<SessionDto> {
    return this.auth.rafraichir(dto.jetonRafraichissement);
  }

  /** Ferme la session de cet appareil. */
  @Post('deconnexion')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  deconnexion(@UtilisateurCourant() utilisateur: UtilisateurConnecte): Promise<void> {
    return this.auth.deconnexion(utilisateur);
  }

  /** Profil, commerce et boutiques accessibles de l'utilisateur connecté. */
  @Get('moi')
  @ApiBearerAuth()
  @ApiOkResponse({ type: ProfilDto })
  moi(@UtilisateurCourant() utilisateur: UtilisateurConnecte): Promise<ProfilDto> {
    return this.auth.profil(utilisateur);
  }

  /** Définit le code PIN (le changer exige le mot de passe). */
  @Put('pin')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  definirPin(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Body() dto: DefinirPinDto,
  ): Promise<void> {
    return this.auth.definirPin(utilisateur, dto.pin, dto.motDePasse);
  }

  /** Vérifie le code PIN sur un nouvel appareil (5 essais par quart d'heure). */
  @Post('pin/verification')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: ResultatPinDto })
  @ApiTooManyRequestsResponse({ description: 'Trop de codes PIN essayés.' })
  verifierPin(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Body() dto: VerifierPinDto,
  ): Promise<ResultatPinDto> {
    return this.auth.verifierPin(utilisateur, dto.pin);
  }
}
