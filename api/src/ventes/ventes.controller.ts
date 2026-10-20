import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { etatGarantie, normaliserImei } from '@gestvente/commun';
import { IsNumber, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { BoutiqueGuard } from '../auth/guards/boutique.guard.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

class ClientGarantieDto {
  @ApiProperty() nom: string;
  @ApiProperty() telephone: string;
}

class GarantieDto {
  @ApiProperty() imei: string;
  @ApiProperty() produit: string;
  @ApiProperty({ description: 'Durée de garantie du produit (mois).' }) garantieMois: number;
  @ApiProperty() venteId: string;
  @ApiProperty({ description: 'Numéro de facture.' }) numero: string;
  @ApiProperty() dateVente: Date;
  @ApiProperty() boutique: string;
  @ApiPropertyOptional({ type: ClientGarantieDto, nullable: true })
  client: ClientGarantieDto | null;
  @ApiPropertyOptional({ nullable: true, type: Date }) finGarantie: Date | null;
  @ApiProperty({ enum: ['SANS', 'EN_COURS', 'EXPIREE'] }) etat: 'SANS' | 'EN_COURS' | 'EXPIREE';
  @ApiPropertyOptional({ description: 'Jours de garantie restants (en cours).' })
  joursRestants?: number;
}

@ApiTags('Ventes')
@ApiBearerAuth()
@Controller('ventes')
export class VentesController {
  constructor(
    private readonly autorisations: AutorisationRemiseService,
    private readonly prisma: PrismaService,
  ) {}

  /** Garantie d'un téléphone vendu, retrouvé par son IMEI : produit, vente, client, temps restant. */
  @Get('garantie/:imei')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @ApiOkResponse({ type: GarantieDto })
  async garantie(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('imei') saisi: string,
  ): Promise<GarantieDto> {
    const imei = normaliserImei(saisi);
    const ligne = await this.prisma.ligneVente.findFirst({
      where: {
        article: { commerceId: utilisateur.commerceId, OR: [{ imei }, { imei2: imei }] },
        vente: { statut: 'VALIDEE' },
      },
      orderBy: { vente: { dateVente: 'desc' } },
      include: {
        article: { select: { imei: true } },
        produit: { select: { nom: true, garantieMois: true } },
        vente: {
          select: {
            id: true,
            numero: true,
            dateVente: true,
            boutique: { select: { nom: true } },
            client: { select: { nom: true, telephone: true } },
          },
        },
      },
    });
    if (!ligne?.article) throw new NotFoundException('Aucune vente de ce téléphone.');
    const etat = etatGarantie(ligne.finGarantie?.toISOString() ?? null, new Date());
    return {
      imei: ligne.article.imei,
      produit: ligne.produit.nom,
      garantieMois: ligne.produit.garantieMois,
      venteId: ligne.vente.id,
      numero: ligne.vente.numero,
      dateVente: ligne.vente.dateVente,
      boutique: ligne.vente.boutique.nom,
      client: ligne.vente.client,
      finGarantie: ligne.finGarantie,
      etat: etat.etat,
      ...(etat.etat === 'EN_COURS' ? { joursRestants: etat.joursRestants } : {}),
    };
  }

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
