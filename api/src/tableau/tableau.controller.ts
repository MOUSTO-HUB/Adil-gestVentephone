import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import type { Regroupement } from '@gestvente/commun';
import { IsIn, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import type { Response } from 'express';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { RapportsPlanifiesService } from './rapports-planifies.service.js';
import { type Periode, TableauService } from './tableau.service.js';

const REGROUPEMENTS = ['jour', 'semaine', 'mois'] as const;
const EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

class FiltreTableauDto {
  @ApiPropertyOptional({ description: 'Début (inclus), ISO 8601 ; défaut : il y a 30 jours.' })
  @IsOptional()
  @IsISO8601()
  du?: string;
  @ApiPropertyOptional({ description: 'Fin (exclue), ISO 8601 ; défaut : maintenant.' })
  @IsOptional()
  @IsISO8601()
  au?: string;
  @ApiPropertyOptional({
    description: 'Une seule boutique ; sinon toutes celles de l’utilisateur.',
  })
  @IsOptional()
  @IsUUID()
  boutiqueId?: string;
  @ApiPropertyOptional({ enum: REGROUPEMENTS })
  @IsOptional()
  @IsIn(REGROUPEMENTS)
  regroupement?: Regroupement;
}

/** Au plus un an et un jour, comme les rapports par boutique. */
const DUREE_MAX_MS = 367 * 86_400_000;

const periode = (f: FiltreTableauDto): Periode => {
  const au = f.au ? new Date(f.au) : new Date();
  const du = f.du ? new Date(f.du) : new Date(au.getTime() - 30 * 86_400_000);
  if (au <= du) throw new BadRequestException('La fin de la période doit suivre son début.');
  if (au.getTime() - du.getTime() > DUREE_MAX_MS) {
    throw new BadRequestException('Période limitée à un an.');
  }
  return { du, au };
};

/**
 * Tableau de bord consolidé (propriétaire : toutes ses boutiques ; gérant : les
 * siennes), situation des trocs, export Excel et rapports planifiés.
 */
@ApiTags('Tableau de bord')
@ApiBearerAuth()
@Controller('tableau')
export class TableauController {
  constructor(
    private readonly tableau: TableauService,
    private readonly planifies: RapportsPlanifiesService,
  ) {}

  @Get()
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ description: 'Chiffres par boutique, total, période précédente, séries.' })
  lire(@UtilisateurCourant() u: UtilisateurConnecte, @Query() f: FiltreTableauDto) {
    return this.tableau.tableau(u, periode(f), f.regroupement ?? 'jour', f.boutiqueId);
  }

  @Get('trocs')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ description: 'Trocs repris, réparés, revendus et marge.' })
  trocs(@UtilisateurCourant() u: UtilisateurConnecte, @Query() f: FiltreTableauDto) {
    return this.tableau.trocs(u, periode(f), f.boutiqueId);
  }

  @Get('excel')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiProduces(EXCEL)
  async excel(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Query() f: FiltreTableauDto,
    @Res() res: Response,
  ): Promise<void> {
    const fichier = await this.tableau.excel(u, periode(f), f.regroupement ?? 'jour', f.boutiqueId);
    res.setHeader('Content-Type', EXCEL);
    res.setHeader('Content-Disposition', 'attachment; filename="tableau-de-bord.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fichier);
  }

  /** Rapports consolidés produits chaque semaine et chaque mois (propriétaire). */
  @Get('archives')
  @Roles(Role.PROPRIETAIRE)
  archives(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.planifies.archives(u.commerceId);
  }

  @Get('archives/:id')
  @Roles(Role.PROPRIETAIRE)
  @ApiProduces(EXCEL)
  async archive(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { archive, octets } = await this.planifies.fichier(u.commerceId, id);
    const nom = `rapport-${archive.frequence.toLowerCase()}-${archive.du.toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', EXCEL);
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(octets);
  }
}
