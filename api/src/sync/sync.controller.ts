import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Instantane, Operation, PageChangements, ResultatOperation } from '@gestvente/commun';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import {
  ConflitDto,
  InstantaneDto,
  LotOperationsDto,
  PageChangementsDto,
  RequeteChangementsDto,
  ResultatLotDto,
} from './sync.dto.js';
import { SyncService } from './sync.service.js';

@ApiTags('Synchronisation')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Opérations faites sur l'appareil (souvent hors ligne), appliquées dans l'ordre.
   * Idempotent : renvoyer un lot déjà reçu redonne les mêmes résultats sans rien rejouer.
   */
  @Post('operations')
  @HttpCode(200)
  @ApiOkResponse({ type: ResultatLotDto })
  async operations(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Body() lot: LotOperationsDto,
  ): Promise<{ resultats: ResultatOperation[] }> {
    return {
      resultats: await this.sync.appliquerLot(utilisateur, lot.operations as Operation[]),
    };
  }

  /** Données complètes des boutiques de l'utilisateur (base locale vide). */
  @Get('instantane')
  @ApiOkResponse({ type: InstantaneDto })
  instantane(@UtilisateurCourant() utilisateur: UtilisateurConnecte): Promise<Instantane> {
    return this.sync.instantane(utilisateur);
  }

  /** Changements depuis le curseur (catalogue et boutiques de l'utilisateur). */
  @Get('changements')
  @ApiOkResponse({ type: PageChangementsDto })
  changements(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Query() requete: RequeteChangementsDto,
  ): Promise<PageChangements> {
    return this.sync.changements(utilisateur, requete.curseur, requete.limite);
  }

  /** Opérations en conflit à traiter par le gérant (ex. IMEI vendu deux fois). */
  @Get('conflits')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ type: [ConflitDto] })
  conflits(@UtilisateurCourant() utilisateur: UtilisateurConnecte): Promise<ConflitDto[]> {
    return this.sync.conflits(utilisateur);
  }

  /** Marque un conflit comme traité. */
  @Post('conflits/:id/traitement')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(204)
  @ApiNoContentResponse()
  traiter(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.sync.traiterConflit(utilisateur, id);
  }
}
