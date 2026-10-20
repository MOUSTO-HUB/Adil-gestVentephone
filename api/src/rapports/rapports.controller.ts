import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProduces,
  ApiPropertyOptional,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Regroupement } from '@gestvente/commun';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Response } from 'express';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { BoutiqueGuard } from '../auth/guards/boutique.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { type Periode, RapportsService } from './rapports.service.js';

/** Au plus un an et un jour par rapport. */
const DUREE_MAX_MS = 367 * 86_400_000;

class PeriodeDto {
  @ApiProperty() @IsUUID() boutiqueId: string;

  @ApiProperty({ description: 'Début inclus (ISO 8601).', example: '2026-10-01T00:00:00.000Z' })
  @IsISO8601()
  du: string;

  @ApiProperty({ description: 'Fin exclue (ISO 8601).', example: '2026-11-01T00:00:00.000Z' })
  @IsISO8601()
  au: string;

  @ApiPropertyOptional({ enum: ['jour', 'semaine', 'mois'], default: 'jour' })
  @IsOptional()
  @IsIn(['jour', 'semaine', 'mois'])
  regroupement: Regroupement = 'jour';
}

class StockDto {
  @ApiProperty() @IsUUID() boutiqueId: string;

  @ApiPropertyOptional({ default: 30, description: 'Sans vente depuis ce nombre de jours.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  jours = 30;
}

class ExcelDto extends PeriodeDto {
  @ApiProperty({ enum: ['ventes', 'stock', 'caisse'] })
  @IsIn(['ventes', 'stock', 'caisse'])
  type: 'ventes' | 'stock' | 'caisse';

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  jours = 30;
}

function periode(dto: PeriodeDto): Periode {
  const du = new Date(dto.du);
  const au = new Date(dto.au);
  if (au <= du) throw new BadRequestException('La fin de la période doit suivre son début.');
  if (au.getTime() - du.getTime() > DUREE_MAX_MS) {
    throw new BadRequestException('Période limitée à un an.');
  }
  return { du, au };
}

/** Rapports de la boutique : réservés au propriétaire et aux gérants de la boutique. */
@ApiTags('Rapports')
@ApiBearerAuth()
@Controller('rapports')
@Roles(Role.PROPRIETAIRE, Role.GERANT)
@UseGuards(BoutiqueGuard)
export class RapportsController {
  constructor(private readonly rapports: RapportsService) {}

  /** Chiffre d'affaires et bénéfice brut par période, vendeur et produit (meilleures ventes). */
  @Get('ventes')
  @ApiOkResponse({ description: 'Totaux, parPeriode, parVendeur, parProduit.' })
  ventes(@UtilisateurCourant() u: UtilisateurConnecte, @Query() dto: PeriodeDto) {
    return this.rapports.ventes(u.commerceId, dto.boutiqueId, periode(dto), dto.regroupement);
  }

  /** Valeur du stock au prix d'achat et de vente ; produits sans vente depuis N jours. */
  @Get('stock')
  @ApiOkResponse({ description: 'Valeurs du stock, produits et produits sans vente.' })
  stock(@UtilisateurCourant() u: UtilisateurConnecte, @Query() dto: StockDto) {
    return this.rapports.stock(u.commerceId, dto.boutiqueId, dto.jours);
  }

  /** Caisses, encaissements par moyen de paiement et dépenses de la période. */
  @Get('caisse')
  @ApiOkResponse({ description: 'Encaissements, caisses et dépenses.' })
  caisse(@UtilisateurCourant() u: UtilisateurConnecte, @Query() dto: PeriodeDto) {
    return this.rapports.caisse(u.commerceId, dto.boutiqueId, periode(dto));
  }

  /** Export Excel d'un rapport. */
  @Get('excel')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async excel(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Query() dto: ExcelDto,
    @Res() res: Response,
  ): Promise<void> {
    const fichier = await this.rapports.excel(
      dto.type,
      u.commerceId,
      dto.boutiqueId,
      periode(dto),
      dto.regroupement,
      dto.jours,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="rapport-${dto.type}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fichier);
  }
}
