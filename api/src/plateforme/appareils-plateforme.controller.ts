import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorateurs.js';
import { CodeAppareilDto, NouveauCodeDto } from '../certificats/certificats.dto.js';
import { CertificatsService } from '../certificats/certificats.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConcepteurCourant, type ConcepteurConnecte, ConcepteurGuard } from './concepteur.guard.js';

/**
 * Espace concepteur : appareils autorisés des concepteurs (entre eux) et de tous les
 * commerçants et de leurs employés (nouvel appareil, révocation de l'ancien).
 */
@ApiTags('Plateforme (concepteur)')
@Public()
@UseGuards(ConcepteurGuard)
@ApiBearerAuth()
@Controller('plateforme')
export class AppareilsPlateformeController {
  constructor(
    private readonly certificats: CertificatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('appareils')
  @ApiQuery({ name: 'commerceId', required: false, description: 'Sans : les concepteurs.' })
  @ApiOkResponse({ description: 'Comptes, appareils autorisés et codes en attente.' })
  async lister(@Query('commerceId', new ParseUUIDPipe({ optional: true })) commerceId?: string) {
    if (commerceId) {
      const utilisateurs = await this.prisma.utilisateur.findMany({
        where: { commerceId },
        select: { id: true, nom: true, identifiant: true, role: true, actif: true },
        orderBy: [{ role: 'asc' }, { nom: 'asc' }],
      });
      return {
        utilisateurs,
        ...(await this.certificats.lister({ utilisateurIds: utilisateurs.map((u) => u.id) })),
      };
    }
    const concepteurs = await this.prisma.concepteur.findMany({
      where: { supprimeLe: null },
      select: { id: true, nom: true, identifiant: true, actif: true },
      orderBy: { nom: 'asc' },
    });
    return {
      utilisateurs: concepteurs.map((c) => ({ ...c, role: 'CONCEPTEUR' })),
      ...(await this.certificats.lister({ concepteurIds: concepteurs.map((c) => c.id) })),
    };
  }

  @Post('utilisateurs/:id/code-appareil')
  @HttpCode(200)
  @ApiOkResponse({ type: CodeAppareilDto })
  async codeUtilisateur(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NouveauCodeDto,
  ): Promise<CodeAppareilDto> {
    const u = await this.prisma.utilisateur.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Utilisateur introuvable.');
    return this.certificats.creerCode(
      { type: 'UTILISATEUR', id: u.id, commerceId: u.commerceId },
      `${c.nom} (GestVente)`,
      dto.remplacer,
    );
  }

  @Post('concepteurs/:id/code-appareil')
  @HttpCode(200)
  @ApiOkResponse({ type: CodeAppareilDto })
  async codeConcepteur(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NouveauCodeDto,
  ): Promise<CodeAppareilDto> {
    const cible = await this.prisma.concepteur.findFirst({ where: { id, supprimeLe: null } });
    if (!cible) throw new NotFoundException('Concepteur introuvable.');
    return this.certificats.creerCode({ type: 'CONCEPTEUR', id: cible.id }, c.nom, dto.remplacer);
  }

  @Post('appareils/:id/revocation')
  @HttpCode(204)
  async revoquer(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    if (!(await this.certificats.certificat(id)))
      throw new NotFoundException('Appareil introuvable.');
    await this.certificats.revoquer(id, `${c.nom} (GestVente)`);
  }
}
