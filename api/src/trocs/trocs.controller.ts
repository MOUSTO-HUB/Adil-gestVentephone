import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
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
import { PHOTOS_TROC_MAX } from '@gestvente/commun';
import type { Response } from 'express';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatImage, StockageService } from '../stockage/stockage.service.js';
import { JournalService } from '../sync/journal.service.js';
import { versTroc } from '../sync/serialisation.js';

const PHOTO_TAILLE_MAX = 2 * 1024 * 1024;
const TYPES_IMAGES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Photos de l'état de l'appareil repris (en ligne : le troc doit être synchronisé).
 * Fichiers dans STOCKAGE_DIR/trocs, jamais dans la base ; servis sans cache au
 * personnel des boutiques de l'utilisateur.
 */
@ApiTags('Troc')
@ApiBearerAuth()
@Controller('trocs')
export class TrocsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockage: StockageService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  private async troc(utilisateur: UtilisateurConnecte, id: string) {
    const troc = await this.prisma.troc.findFirst({
      where: { id, commerceId: utilisateur.commerceId },
    });
    if (!troc || !utilisateur.boutiqueIds.includes(troc.boutiqueId)) {
      throw new NotFoundException('Troc introuvable.');
    }
    return troc;
  }

  /** Photo n° `numero` (à partir de 1) de l'appareil repris. */
  @Get(':id/photos/:numero')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async photo(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('numero', ParseIntPipe) numero: number,
    @Res() res: Response,
  ): Promise<void> {
    const troc = await this.troc(utilisateur, id);
    const cle = troc.photoCles[numero - 1];
    const octets = cle ? await this.stockage.lirePhoto(cle, 'trocs') : null;
    if (!cle || !octets) throw new NotFoundException('Photo introuvable.');
    res.setHeader(
      'Content-Type',
      TYPES_IMAGES[cle.split('.').pop() ?? ''] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(octets);
  }

  /** Ajoute une photo (compressée par l'application), dans la limite de PHOTOS_TROC_MAX. */
  @Post(':id/photos')
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @HttpCode(204)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } } },
  })
  @ApiNoContentResponse()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PHOTO_TAILLE_MAX, files: 1 } }))
  async ajouter(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier?: Express.Multer.File,
  ): Promise<void> {
    if (!fichier) throw new BadRequestException('Photo manquante (champ « photo »).');
    const format = formatImage(fichier.buffer);
    if (!format) {
      throw new BadRequestException('Format d’image non pris en charge (JPEG, PNG ou WebP).');
    }
    await this.troc(utilisateur, id);
    const nom = await this.stockage.enregistrerPhoto(fichier.buffer, format, 'trocs');
    await this.prisma
      .$transaction(async (tx) => {
        await this.journal.verrouiller(tx, utilisateur.commerceId);
        const avant = await tx.troc.findUniqueOrThrow({ where: { id } });
        if (avant.photoCles.length >= PHOTOS_TROC_MAX) {
          throw new ConflictException(`${PHOTOS_TROC_MAX} photos au plus par appareil repris.`);
        }
        const apres = await tx.troc.update({
          where: { id },
          data: { photoCles: { push: nom } },
        });
        await this.journal.ecrire(tx, utilisateur.commerceId, [
          { entite: 'troc', id, boutiqueId: apres.boutiqueId, donnees: versTroc(apres) },
        ]);
        await this.audit.journaliser(
          {
            commerceId: utilisateur.commerceId,
            boutiqueId: apres.boutiqueId,
            action: ACTIONS_AUDIT.PHOTO_TROC,
            utilisateurId: utilisateur.id,
            appareilId: utilisateur.appareilId,
            entite: 'Troc',
            entiteId: id,
          },
          tx,
        );
      })
      .catch(async (e: unknown) => {
        await this.stockage.supprimerPhoto(nom, 'trocs');
        throw e;
      });
  }
}
