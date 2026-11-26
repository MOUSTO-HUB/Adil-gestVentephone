import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { peutGererSessionsDe } from '../auth/acces.regles.js';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Public, Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CodeAppareilDto, NouveauCodeDto, PreuveAppareilDto } from './certificats.dto.js';
import { CertificatsService } from './certificats.service.js';

const MESSAGE_INTERDIT = 'Vous ne gérez pas les appareils de cette personne.';

/**
 * Appareils autorisés des commerçants : défi de connexion, certification d'une session
 * déjà ouverte, et administration par le propriétaire (tous ses employés) ou un gérant
 * (les vendeurs de ses boutiques).
 */
@ApiTags('Appareils autorisés')
@Controller()
export class CertificatsController {
  constructor(
    private readonly certificats: CertificatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('auth/defi')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Défi à signer par l’appareil (valable 3 minutes).' })
  defi() {
    return this.certificats.defi();
  }

  @Post('auth/appareil/certificat')
  @ApiBearerAuth()
  @Roles(Role.PROPRIETAIRE, Role.GERANT, Role.VENDEUR)
  @HttpCode(200)
  @ApiOkResponse({
    description: 'Appareil de la session ouverte avant la certification, enregistré.',
  })
  certifierSession(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Body() preuve: PreuveAppareilDto,
  ) {
    return this.certificats.certifierSession(
      { type: 'UTILISATEUR', id: u.id, commerceId: u.commerceId },
      u.appareilId,
      preuve,
    );
  }

  @Get('appareils/autorises')
  @ApiBearerAuth()
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({
    description: 'Personnes gérées, leurs appareils autorisés et codes en attente.',
  })
  async lister(@UtilisateurCourant() acteur: UtilisateurConnecte) {
    const personnes = (await this.personnes(acteur.commerceId)).filter((p) =>
      peutGererSessionsDe(acteur, p.acteur),
    );
    return {
      utilisateurs: personnes.map((p) => ({
        id: p.id,
        nom: p.nom,
        identifiant: p.identifiant,
        role: p.role,
        actif: p.actif,
      })),
      ...(await this.certificats.lister({ utilisateurIds: personnes.map((p) => p.id) })),
    };
  }

  @Post('utilisateurs/:id/code-appareil')
  @ApiBearerAuth()
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(200)
  @ApiOkResponse({ type: CodeAppareilDto })
  async code(
    @UtilisateurCourant() acteur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NouveauCodeDto,
  ): Promise<CodeAppareilDto> {
    const cible = await this.verifierDroit(acteur, id);
    return this.certificats.creerCode(
      { type: 'UTILISATEUR', id: cible.id, commerceId: acteur.commerceId },
      await this.nom(acteur.id),
      dto.remplacer,
    );
  }

  @Post('appareils/autorises/:id/revocation')
  @ApiBearerAuth()
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @HttpCode(204)
  async revoquer(
    @UtilisateurCourant() acteur: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const certificat = await this.certificats.certificat(id);
    if (!certificat?.utilisateurId || certificat.commerceId !== acteur.commerceId) {
      throw new NotFoundException('Appareil introuvable.');
    }
    await this.verifierDroit(acteur, certificat.utilisateurId);
    await this.certificats.revoquer(id, await this.nom(acteur.id));
  }

  private async personnes(commerceId: string) {
    const utilisateurs = await this.prisma.utilisateur.findMany({
      where: { commerceId },
      select: {
        id: true,
        nom: true,
        identifiant: true,
        role: true,
        actif: true,
        commerceId: true,
        boutiques: { select: { boutiqueId: true } },
      },
      orderBy: [{ role: 'asc' }, { nom: 'asc' }],
    });
    return utilisateurs.map((u) => ({
      ...u,
      acteur: {
        id: u.id,
        role: u.role,
        commerceId: u.commerceId,
        boutiqueIds: u.boutiques.map((b) => b.boutiqueId),
      },
    }));
  }

  private async verifierDroit(acteur: UtilisateurConnecte, titulaireId: string) {
    const cible = (await this.personnes(acteur.commerceId)).find((p) => p.id === titulaireId);
    if (!cible) throw new NotFoundException('Utilisateur introuvable.');
    if (!peutGererSessionsDe(acteur, cible.acteur)) throw new ForbiddenException(MESSAGE_INTERDIT);
    return cible;
  }

  private async nom(utilisateurId: string) {
    const u = await this.prisma.utilisateur.findUnique({
      where: { id: utilisateurId },
      select: { nom: true },
    });
    return u?.nom ?? 'Administrateur';
  }
}
