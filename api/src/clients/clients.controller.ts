import {
  BadRequestException,
  Controller,
  Delete,
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
  ApiOkResponse,
  ApiProduces,
  ApiProperty,
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
import { versClient } from '../sync/serialisation.js';
import { detteFournisseur } from './clients.ecritures.js';

export const PIECE_TAILLE_MAX = 2 * 1024 * 1024;
const TYPES_IMAGES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const TOUS = [Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR];

class VenteHistoriqueDto {
  @ApiProperty() id: string;
  @ApiProperty() numero: string;
  @ApiProperty() date: Date;
  @ApiProperty() total: number;
  @ApiProperty() statut: string;
  @ApiProperty() boutique: string;
}

class CreditHistoriqueDto {
  @ApiProperty() id: string;
  @ApiProperty() date: Date;
  @ApiProperty() montantTotal: number;
  @ApiProperty() montantRestant: number;
  @ApiProperty() statut: string;
}

class TrocHistoriqueDto {
  @ApiProperty() id: string;
  @ApiProperty() date: Date;
  @ApiProperty() description: string;
  @ApiProperty() valeurRetenue: number;
}

class HistoriqueClientDto {
  @ApiProperty({ type: [VenteHistoriqueDto] }) ventes: VenteHistoriqueDto[];
  @ApiProperty({ type: [CreditHistoriqueDto] }) credits: CreditHistoriqueDto[];
  @ApiProperty({ type: [TrocHistoriqueDto] }) trocs: TrocHistoriqueDto[];
}

class AchatFournisseurDto {
  @ApiProperty() id: string;
  @ApiProperty() numero: string;
  @ApiProperty() date: Date;
  @ApiProperty() statut: string;
  @ApiProperty() montantTotal: number;
  @ApiProperty() montantPaye: number;
  @ApiProperty() reste: number;
  @ApiProperty() boutique: string;
}

class AchatsFournisseurDto {
  @ApiProperty({ description: 'Reste dû au fournisseur.' }) dette: number;
  @ApiProperty({ type: [AchatFournisseurDto] }) achats: AchatFournisseurDto[];
}

@ApiTags('Clients et fournisseurs')
@ApiBearerAuth()
@Controller()
export class ClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockage: StockageService,
    private readonly journal: JournalService,
    private readonly audit: AuditService,
  ) {}

  private async client(utilisateur: UtilisateurConnecte, id: string) {
    const client = await this.prisma.client.findFirst({
      where: { id, commerceId: utilisateur.commerceId },
    });
    if (!client) throw new NotFoundException('Client introuvable.');
    return client;
  }

  /** Achats, crédits et trocs d'un client (en ligne). */
  @Get('clients/:id/historique')
  @Roles(...TOUS)
  @ApiOkResponse({ type: HistoriqueClientDto })
  async historique(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HistoriqueClientDto> {
    const client = await this.client(utilisateur, id);
    const [ventes, credits, trocs] = await Promise.all([
      this.prisma.vente.findMany({
        where: { clientId: client.id },
        orderBy: { dateVente: 'desc' },
        take: 50,
        include: { boutique: { select: { nom: true } } },
      }),
      this.prisma.credit.findMany({
        where: { clientId: client.id },
        orderBy: { creeLe: 'desc' },
        take: 50,
      }),
      this.prisma.troc.findMany({
        where: { clientId: client.id },
        orderBy: { creeLe: 'desc' },
        take: 50,
        include: { article: { select: { produit: { select: { nom: true } } } } },
      }),
    ]);
    return {
      ventes: ventes.map((v) => ({
        id: v.id,
        numero: v.numero,
        date: v.dateVente,
        total: Number(v.total),
        statut: v.statut,
        boutique: v.boutique.nom,
      })),
      credits: credits.map((c) => ({
        id: c.id,
        date: c.creeLe,
        montantTotal: Number(c.montantTotal),
        montantRestant: Number(c.montantRestant),
        statut: c.statut,
      })),
      trocs: trocs.map((t) => ({
        id: t.id,
        date: t.creeLe,
        description: `${t.article?.produit.nom ?? 'Téléphone'} · IMEI ${t.imei}`,
        valeurRetenue: Number(t.valeurRetenue),
      })),
    };
  }

  /**
   * Photo de la pièce d'identité : réservée au personnel connecté, jamais mise en
   * cache, chaque consultation inscrite au journal d'audit.
   */
  @Get('clients/:id/piece')
  @Roles(...TOUS)
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async piece(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const client = await this.client(utilisateur, id);
    const octets = client.photoPieceCle
      ? await this.stockage.lirePhoto(client.photoPieceCle, 'pieces')
      : null;
    if (!client.photoPieceCle || !octets) throw new NotFoundException('Aucune photo de pièce.');
    await this.audit.journaliser({
      commerceId: utilisateur.commerceId,
      action: ACTIONS_AUDIT.PIECE_IDENTITE_CONSULTEE,
      utilisateurId: utilisateur.id,
      appareilId: utilisateur.appareilId,
      entite: 'Client',
      entiteId: client.id,
    });
    res.setHeader(
      'Content-Type',
      TYPES_IMAGES[client.photoPieceCle.split('.').pop() ?? ''] ?? 'application/octet-stream',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(octets);
  }

  /** Enregistre la photo de la pièce d'identité (compressée par l'application, 2 Mo au plus). */
  @Put('clients/:id/piece')
  @Roles(...TOUS)
  @HttpCode(204)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } } },
  })
  @ApiNoContentResponse()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: PIECE_TAILLE_MAX, files: 1 } }))
  async envoyerPiece(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() fichier?: Express.Multer.File,
  ): Promise<void> {
    if (!fichier) throw new BadRequestException('Photo manquante (champ « photo »).');
    const format = formatImage(fichier.buffer);
    if (!format)
      throw new BadRequestException('Format d’image non pris en charge (JPEG, PNG ou WebP).');
    await this.client(utilisateur, id);
    const nom = await this.stockage.enregistrerPhoto(fichier.buffer, format, 'pieces');
    const ancienne = await this.remplacerPiece(utilisateur, id, nom).catch(async (e: unknown) => {
      await this.stockage.supprimerPhoto(nom, 'pieces');
      throw e;
    });
    await this.stockage.supprimerPhoto(ancienne, 'pieces');
  }

  @Delete('clients/:id/piece')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(204)
  @ApiNoContentResponse()
  async supprimerPiece(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.stockage.supprimerPhoto(await this.remplacerPiece(utilisateur, id, null), 'pieces');
  }

  private remplacerPiece(utilisateur: UtilisateurConnecte, clientId: string, nom: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await this.journal.verrouiller(tx, utilisateur.commerceId);
      const client = await tx.client.findFirst({
        where: { id: clientId, commerceId: utilisateur.commerceId },
      });
      if (!client) throw new NotFoundException('Client introuvable.');
      const modifie = await tx.client.update({
        where: { id: client.id },
        data: { photoPieceCle: nom },
      });
      await this.journal.ecrire(tx, utilisateur.commerceId, [
        { entite: 'client', id: modifie.id, boutiqueId: null, donnees: versClient(modifie) },
      ]);
      await this.audit.journaliser(
        {
          commerceId: utilisateur.commerceId,
          action: ACTIONS_AUDIT.PIECE_IDENTITE_MODIFIEE,
          utilisateurId: utilisateur.id,
          appareilId: utilisateur.appareilId,
          entite: 'Client',
          entiteId: client.id,
          details: { supprimee: nom === null },
        },
        tx,
      );
      return client.photoPieceCle;
    });
  }

  /** Bons d'achat du fournisseur et reste dû (en ligne). */
  @Get('fournisseurs/:id/achats')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ type: AchatsFournisseurDto })
  async achats(
    @UtilisateurCourant() utilisateur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AchatsFournisseurDto> {
    const fournisseur = await this.prisma.fournisseur.findFirst({
      where: { id, commerceId: utilisateur.commerceId },
    });
    if (!fournisseur) throw new NotFoundException('Fournisseur introuvable.');
    const achats = await this.prisma.achat.findMany({
      where: { fournisseurId: id },
      orderBy: { dateAchat: 'desc' },
      take: 100,
      include: { boutique: { select: { nom: true } } },
    });
    return {
      dette: await detteFournisseur(this.prisma, id),
      achats: achats.map((a) => ({
        id: a.id,
        numero: a.numero,
        date: a.dateAchat,
        statut: a.statut,
        montantTotal: Number(a.montantTotal),
        montantPaye: Number(a.montantPaye),
        reste: Number(a.montantTotal - a.montantPaye),
        boutique: a.boutique.nom,
      })),
    };
  }
}
