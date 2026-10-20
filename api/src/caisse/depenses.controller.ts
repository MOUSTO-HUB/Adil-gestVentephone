import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiNoContentResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatImage, StockageService } from '../stockage/stockage.service.js';
import { JournalService } from '../sync/journal.service.js';
import { versDepense } from '../sync/serialisation.js';

const JUSTIFICATIF_TAILLE_MAX = 2 * 1024 * 1024;
const TYPES_IMAGES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Photo du justificatif d'une dépense (en ligne : la dépense doit être synchronisée). */
@ApiTags('Caisse')
@ApiBearerAuth()
@Controller('depenses')
export class DepensesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockage: StockageService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  /** L'auteur de la dépense ou la gestion, dans les boutiques de l'utilisateur. */
  private async depense(utilisateur: UtilisateurConnecte, id: string) {
    const depense = await this.prisma.depense.findFirst({
      where: { id, commerceId: utilisateur.commerceId },
    });
    if (
      !depense ||
      (utilisateur.role !== Role.PROPRIETAIRE &&
        !utilisateur.boutiqueIds.includes(depense.boutiqueId))
    ) {
      throw new NotFoundException('Dépense introuvable.');
    }
    if (utilisateur.role === Role.VENDEUR && depense.creeParId !== utilisateur.id) {
      throw new ForbiddenException('Seuls son auteur et la gestion accèdent à ce justificatif.');
    }
    return depense;
  }

  @Get(':id/justificatif')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async justificatif(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const depense = await this.depense(utilisateur, id);
    const octets = depense.justificatifCle
      ? await this.stockage.lirePhoto(depense.justificatifCle, 'justificatifs')
      : null;
    if (!depense.justificatifCle || !octets) throw new NotFoundException('Aucun justificatif.');
    res.setHeader(
      'Content-Type',
      TYPES_IMAGES[depense.justificatifCle.split('.').pop() ?? ''] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(octets);
  }

  /** Enregistre (ou remplace) la photo du justificatif, compressée par l'application. */
  @Put(':id/justificatif')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @HttpCode(204)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } } },
  })
  @ApiNoContentResponse()
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: JUSTIFICATIF_TAILLE_MAX, files: 1 } }),
  )
  async envoyer(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier?: Express.Multer.File,
  ): Promise<void> {
    if (!fichier) throw new BadRequestException('Photo manquante (champ « photo »).');
    const format = formatImage(fichier.buffer);
    if (!format) {
      throw new BadRequestException('Format d’image non pris en charge (JPEG, PNG ou WebP).');
    }
    await this.depense(utilisateur, id);
    const nom = await this.stockage.enregistrerPhoto(fichier.buffer, format, 'justificatifs');
    const ancienne = await this.prisma
      .$transaction(async (tx) => {
        await this.journal.verrouiller(tx, utilisateur.commerceId);
        const avant = await tx.depense.findUniqueOrThrow({ where: { id } });
        const apres = await tx.depense.update({ where: { id }, data: { justificatifCle: nom } });
        await this.journal.ecrire(tx, utilisateur.commerceId, [
          { entite: 'depense', id, boutiqueId: apres.boutiqueId, donnees: versDepense(apres) },
        ]);
        await this.audit.journaliser(
          {
            commerceId: utilisateur.commerceId,
            boutiqueId: apres.boutiqueId,
            action: ACTIONS_AUDIT.JUSTIFICATIF_MODIFIE,
            utilisateurId: utilisateur.id,
            appareilId: utilisateur.appareilId,
            entite: 'Depense',
            entiteId: id,
          },
          tx,
        );
        return avant.justificatifCle;
      })
      .catch(async (e: unknown) => {
        await this.stockage.supprimerPhoto(nom, 'justificatifs');
        throw e;
      });
    await this.stockage.supprimerPhoto(ancienne, 'justificatifs');
  }
}
