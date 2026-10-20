import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import type { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

class JournalDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() boutiqueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() utilisateurId?: string;

  @ApiPropertyOptional({ description: 'Actions, séparées par des virgules.' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  actions?: string[];

  @ApiPropertyOptional() @IsOptional() @IsISO8601() du?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() au?: string;

  @ApiPropertyOptional({ description: 'Page suivante : entrées antérieures à cette date.' })
  @IsOptional()
  @IsISO8601()
  avant?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limite = 50;
}

/**
 * Journal des opérations sensibles (connexions, remises, prix, annulations, stock,
 * caisse). Le propriétaire voit tout le commerce ; un gérant, ses boutiques et
 * les connexions de leur personnel.
 */
@ApiTags('Journal d’audit')
@ApiBearerAuth()
@Controller('audit')
@Roles(Role.PROPRIETAIRE, Role.GERANT)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  /** Personnel visible par l'utilisateur (filtre « utilisateur » du journal). */
  private async personnel(u: UtilisateurConnecte) {
    return this.prisma.utilisateur.findMany({
      where: {
        commerceId: u.commerceId,
        ...(u.role === Role.PROPRIETAIRE
          ? {}
          : {
              OR: [
                { id: u.id },
                {
                  role: { not: Role.PROPRIETAIRE },
                  boutiques: { some: { boutiqueId: { in: u.boutiqueIds } } },
                },
              ],
            }),
      },
      select: { id: true, nom: true, role: true },
      orderBy: { nom: 'asc' },
    });
  }

  @Get('utilisateurs')
  @ApiOkResponse({ description: 'Utilisateurs visibles dans le journal.' })
  utilisateurs(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.personnel(u);
  }

  @Get()
  @ApiOkResponse({
    description: 'Entrées du journal, les plus récentes d’abord, et page suivante.',
  })
  async journal(@UtilisateurCourant() u: UtilisateurConnecte, @Query() dto: JournalDto) {
    const where: Prisma.JournalAuditWhereInput = { commerceId: u.commerceId };
    const filtres: Prisma.JournalAuditWhereInput[] = [];
    if (u.role !== Role.PROPRIETAIRE) {
      const visibles = (await this.personnel(u)).map((p) => p.id);
      filtres.push({
        OR: [
          { boutiqueId: { in: u.boutiqueIds } },
          { boutiqueId: null, utilisateurId: { in: visibles } },
        ],
      });
    }
    if (dto.boutiqueId) filtres.push({ boutiqueId: dto.boutiqueId });
    if (dto.utilisateurId) filtres.push({ utilisateurId: dto.utilisateurId });
    if (dto.actions?.length) filtres.push({ action: { in: dto.actions } });
    const date: Prisma.DateTimeFilter = {};
    if (dto.du) date.gte = new Date(dto.du);
    if (dto.au) date.lt = new Date(dto.au);
    if (dto.avant)
      date.lt = date.lt && date.lt < new Date(dto.avant) ? date.lt : new Date(dto.avant);
    if (Object.keys(date).length) filtres.push({ creeLe: date });
    if (filtres.length) where.AND = filtres;

    const entrees = await this.prisma.journalAudit.findMany({
      where,
      orderBy: { creeLe: 'desc' },
      take: dto.limite + 1,
    });
    const page = entrees.slice(0, dto.limite);
    const [utilisateurs, boutiques] = await Promise.all([
      this.prisma.utilisateur.findMany({
        where: { id: { in: page.flatMap((e) => (e.utilisateurId ? [e.utilisateurId] : [])) } },
        select: { id: true, nom: true },
      }),
      this.prisma.boutique.findMany({
        where: { id: { in: page.flatMap((e) => (e.boutiqueId ? [e.boutiqueId] : [])) } },
        select: { id: true, nom: true },
      }),
    ]);
    return {
      entrees: page.map((e) => ({
        id: e.id,
        creeLe: e.creeLe.toISOString(),
        action: e.action,
        utilisateur: utilisateurs.find((x) => x.id === e.utilisateurId)?.nom ?? null,
        boutique: boutiques.find((x) => x.id === e.boutiqueId)?.nom ?? null,
        entite: e.entite,
        entiteId: e.entiteId,
        details: e.details,
        ip: e.ip,
      })),
      suivant: entrees.length > dto.limite ? page[page.length - 1]!.creeLe.toISOString() : null,
    };
  }
}
