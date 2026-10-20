import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseBoolPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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
  ApiOkResponse,
  ApiProduces,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Public, Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { formatImage, StockageService } from '../stockage/stockage.service.js';
import { JournalService } from '../sync/journal.service.js';
import { versProduit } from '../sync/serialisation.js';
import { ImportService, type RapportImport } from './import.service.js';

export const PHOTO_TAILLE_MAX = 2 * 1024 * 1024;
export const IMPORT_TAILLE_MAX = 5 * 1024 * 1024;
const TYPES_IMAGES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

class PhotoDto {
  @ApiProperty({ description: 'Nom du fichier, servi par GET /api/photos/:nom.' }) photo: string;
}

class ErreurLigneDto {
  @ApiProperty() ligne: number;
  @ApiProperty({ type: [String] }) messages: string[];
}

class RapportImportDto {
  @ApiProperty() simulation: boolean;
  @ApiProperty() lignes: number;
  @ApiProperty() crees: number;
  @ApiProperty() modifies: number;
  @ApiProperty({ type: [ErreurLigneDto] }) erreurs: ErreurLigneDto[];
}

const fichierMultipart = (champ: string) => ({
  schema: { type: 'object', properties: { [champ]: { type: 'string', format: 'binary' } } },
});

@ApiTags('Catalogue')
@Controller()
export class CatalogueController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockage: StockageService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
    private readonly imports: ImportService,
  ) {}

  /** Photo d'un produit (compressée par l'application avant envoi, 2 Mo au plus). */
  @Put('catalogue/produits/:id/photo')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody(fichierMultipart('photo'))
  @ApiOkResponse({ type: PhotoDto })
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PHOTO_TAILLE_MAX, files: 1 } }))
  async envoyerPhoto(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier?: Express.Multer.File,
  ): Promise<PhotoDto> {
    if (!fichier) throw new BadRequestException('Photo manquante (champ « photo »).');
    const format = formatImage(fichier.buffer);
    if (!format)
      throw new BadRequestException('Format d’image non pris en charge (JPEG, PNG ou WebP).');
    const nom = await this.stockage.enregistrerPhoto(fichier.buffer, format);
    const ancienne = await this.remplacerPhoto(utilisateur, id, nom).catch(
      async (erreur: unknown) => {
        await this.stockage.supprimerPhoto(nom);
        throw erreur;
      },
    );
    await this.stockage.supprimerPhoto(ancienne);
    return { photo: nom };
  }

  @Delete('catalogue/produits/:id/photo')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiNoContentResponse()
  async supprimerPhoto(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.stockage.supprimerPhoto(await this.remplacerPhoto(utilisateur, id, null));
  }

  /** Change la photo en base, la fait descendre aux appareils ; renvoie l'ancienne. */
  private async remplacerPhoto(
    utilisateur: UtilisateurConnecte,
    produitId: string,
    nom: string | null,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.journal.verrouiller(tx, utilisateur.commerceId);
      const produit = await tx.produit.findFirst({
        where: { id: produitId, commerceId: utilisateur.commerceId },
      });
      if (!produit) throw new NotFoundException('Produit introuvable.');
      const modifie = await tx.produit.update({
        where: { id: produit.id },
        data: { photoCle: nom },
      });
      await this.journal.ecrire(tx, utilisateur.commerceId, [
        { entite: 'produit', id: modifie.id, boutiqueId: null, donnees: versProduit(modifie) },
      ]);
      await this.audit.journaliser(
        {
          commerceId: utilisateur.commerceId,
          action: ACTIONS_AUDIT.PHOTO_MODIFIEE,
          utilisateurId: utilisateur.id,
          appareilId: utilisateur.appareilId,
          entite: 'Produit',
          entiteId: produit.id,
        },
        tx,
      );
      return produit.photoCle;
    });
  }

  /**
   * Photos des produits : publiques (images du catalogue, sans donnée personnelle),
   * sous un nom aléatoire qui change à chaque nouvelle photo, donc gardées en cache.
   */
  @Public()
  @Get('photos/:nom')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async photo(@Param('nom') nom: string, @Res() res: Response): Promise<void> {
    const octets = await this.stockage.lirePhoto(nom);
    if (!octets) throw new NotFoundException('Photo introuvable.');
    res.setHeader(
      'Content-Type',
      TYPES_IMAGES[nom.split('.').pop() ?? ''] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(octets);
  }

  /** Import du catalogue depuis Excel ; `simulation=true` : rapport sans rien enregistrer. */
  @Post('catalogue/import')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody(fichierMultipart('fichier'))
  @ApiQuery({ name: 'simulation', required: false, type: Boolean })
  @ApiOkResponse({ type: RapportImportDto })
  @UseInterceptors(
    FileInterceptor('fichier', { limits: { fileSize: IMPORT_TAILLE_MAX, files: 1 } }),
  )
  importer(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Query('simulation', new ParseBoolPipe({ optional: true })) simulation = false,
    @UploadedFile() fichier?: Express.Multer.File,
  ): Promise<RapportImport> {
    if (!fichier) throw new BadRequestException('Fichier manquant (champ « fichier »).');
    return this.imports.importer(utilisateur, fichier.buffer, simulation);
  }

  /** Classeur modèle à remplir pour l'import. */
  @Get('catalogue/import/modele')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiBearerAuth()
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async modele(@Res() res: Response): Promise<void> {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="modele-catalogue.xlsx"');
    res.send(await this.imports.modele());
  }
}
