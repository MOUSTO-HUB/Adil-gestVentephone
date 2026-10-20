import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BoutiqueResumeDto } from '../auth/auth.dto.js';
import { BoutiqueGuard } from '../auth/guards/boutique.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

const CHAMPS = { id: true, nom: true, prefixe: true, adresse: true } as const;

@ApiTags('Boutiques')
@ApiBearerAuth()
@Controller('boutiques')
export class BoutiquesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Une boutique accessible à l'utilisateur (rattachement vérifié par BoutiqueGuard). */
  @Get(':boutiqueId')
  @UseGuards(BoutiqueGuard)
  @ApiOkResponse({ type: BoutiqueResumeDto })
  @ApiForbiddenResponse({ description: 'Boutique à laquelle vous n’êtes pas rattaché.' })
  lire(@Param('boutiqueId') boutiqueId: string): Promise<BoutiqueResumeDto> {
    return this.prisma.boutique.findUniqueOrThrow({ where: { id: boutiqueId }, select: CHAMPS });
  }
}
