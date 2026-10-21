import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CanalMessage,
  CANAUX_MESSAGE,
  erreurModele,
  factureHtml,
  STATUTS_MESSAGE,
  type StatutMessage,
  type TypeMessage,
  TYPES_MESSAGE,
} from '@gestvente/commun';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Response } from 'express';
import { ACTIONS_AUDIT, AuditService } from '../audit/audit.service.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Public, Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { codeValide, documentVente } from './facture-publique.js';
import { MessagesService } from './messages.service.js';

class FiltresMessagesDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() clientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() boutiqueId?: string;
  @ApiPropertyOptional({ enum: STATUTS_MESSAGE })
  @IsOptional()
  @IsIn(STATUTS_MESSAGE)
  statut?: StatutMessage;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() du?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() au?: string;
  @ApiPropertyOptional({ description: 'Page suivante : messages antérieurs à cette date.' })
  @IsOptional()
  @IsISO8601()
  avant?: string;
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite = 50;
}

class ModeleDto {
  @ApiProperty({ enum: TYPES_MESSAGE }) @IsIn(TYPES_MESSAGE) type: TypeMessage;
  @ApiProperty({
    enum: ['SMS'],
    description: 'Seuls les SMS se modifient (WhatsApp : modèles approuvés).',
  })
  @IsIn(['SMS'])
  canal: CanalMessage;
  @ApiProperty() @IsString() @Length(1, 1000) texte: string;
}

/** Page publique d'une facture (lien envoyé au client par SMS ou WhatsApp). */
@ApiTags('Messages')
@Controller('f')
export class FacturePubliqueController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get(':code')
  @ApiProduces('text/html')
  async facture(@Param('code') code: string, @Res() res: Response): Promise<void> {
    const document = codeValide(code) ? await documentVente(this.prisma, code) : null;
    if (!document) throw new NotFoundException('Facture introuvable.');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Page autonome : styles intégrés seulement, aucun script.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.send(factureHtml(document));
  }
}

/** Historique des envois et modèles de textes (gestion ; textes : propriétaire). */
@ApiTags('Messages')
@ApiBearerAuth()
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ description: 'Messages les plus récents d’abord, et page suivante.' })
  async liste(@UtilisateurCourant() u: UtilisateurConnecte, @Query() f: FiltresMessagesDto) {
    const filtres: Prisma.MessageWhereInput[] = [{ commerceId: u.commerceId }];
    if (u.role !== Role.PROPRIETAIRE) filtres.push({ boutiqueId: { in: u.boutiqueIds } });
    if (f.boutiqueId) filtres.push({ boutiqueId: f.boutiqueId });
    if (f.clientId) filtres.push({ clientId: f.clientId });
    if (f.statut) filtres.push({ statut: f.statut });
    if (f.du) filtres.push({ creeLe: { gte: new Date(f.du) } });
    if (f.au) filtres.push({ creeLe: { lt: new Date(f.au) } });
    if (f.avant) filtres.push({ creeLe: { lt: new Date(f.avant) } });
    const messages = await this.prisma.message.findMany({
      where: { AND: filtres },
      orderBy: { creeLe: 'desc' },
      take: f.limite + 1,
      include: { client: { select: { nom: true } } },
    });
    const page = messages.slice(0, f.limite);
    return {
      whatsappDisponible: this.messages.whatsappDisponible,
      messages: page.map((m) => ({
        id: m.id,
        creeLe: m.creeLe.toISOString(),
        envoyeLe: m.envoyeLe?.toISOString() ?? null,
        canal: m.canal,
        type: m.type,
        statut: m.statut,
        destinataire: m.destinataire,
        client: m.client?.nom ?? null,
        contenu: m.contenu,
        essais: m.essais,
        cout: m.cout === null ? null : Number(m.cout),
        erreur: m.erreur,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
      })),
      suivant: messages.length > f.limite ? page[page.length - 1]!.creeLe.toISOString() : null,
    };
  }

  @Get('modeles')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ description: 'Texte de chaque type de message, par canal.' })
  modeles(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.messages.modeles(u.commerceId);
  }

  @Put('modeles')
  @Roles(Role.PROPRIETAIRE)
  @HttpCode(204)
  @ApiNoContentResponse()
  async modifier(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Body() dto: ModeleDto,
  ): Promise<void> {
    const erreur = erreurModele(dto.texte, dto.canal);
    if (erreur) throw new BadRequestException(erreur);
    const cle = { commerceId: u.commerceId, type: dto.type, canal: dto.canal };
    const avant = await this.prisma.modeleMessage.findUnique({
      where: { commerceId_type_canal: cle },
    });
    await this.prisma.modeleMessage.upsert({
      where: { commerceId_type_canal: cle },
      create: { ...cle, texte: dto.texte.trim(), modifieParId: u.id },
      update: { texte: dto.texte.trim(), modifieParId: u.id },
    });
    await this.audit.journaliser({
      commerceId: u.commerceId,
      action: ACTIONS_AUDIT.MODELE_MESSAGE_MODIFIE,
      utilisateurId: u.id,
      appareilId: u.appareilId,
      entite: 'ModeleMessage',
      details: {
        type: dto.type,
        canal: dto.canal,
        avant: avant?.texte ?? null,
        apres: dto.texte.trim(),
      },
    });
  }

  @Delete('modeles/:type/:canal')
  @Roles(Role.PROPRIETAIRE)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Retour au texte par défaut.' })
  async reinitialiser(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Param('type') type: string,
    @Param('canal') canal: string,
  ): Promise<void> {
    if (
      !TYPES_MESSAGE.includes(type as TypeMessage) ||
      !CANAUX_MESSAGE.includes(canal as CanalMessage)
    ) {
      throw new BadRequestException('Type ou canal inconnu.');
    }
    await this.prisma.modeleMessage.deleteMany({
      where: { commerceId: u.commerceId, type: type as TypeMessage, canal: canal as CanalMessage },
    });
    await this.audit.journaliser({
      commerceId: u.commerceId,
      action: ACTIONS_AUDIT.MODELE_MESSAGE_MODIFIE,
      utilisateurId: u.id,
      appareilId: u.appareilId,
      entite: 'ModeleMessage',
      details: { type, canal, reinitialise: true },
    });
  }

  @Post(':id/relancer')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(204)
  @ApiNoContentResponse()
  async relancer(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.messages.relancer(u.commerceId, id);
  }
}
