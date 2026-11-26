import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { FORMULES_ABONNEMENT, type FormuleAbonnement } from '@gestvente/commun';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  Max,
  Min,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppareilDto } from '../auth/auth.dto.js';
import { Public } from '../auth/decorateurs.js';
import { PreuveAppareilDto } from '../certificats/certificats.dto.js';
import { LIMITES, LimiteurService } from '../securite/limiteur.service.js';
import type { MoyenPaiement, StatutCommerce } from '../generated/prisma/enums.js';
import { ConcepteurCourant, type ConcepteurConnecte, ConcepteurGuard } from './concepteur.guard.js';
import { PlateformeService } from './plateforme.service.js';

const STATUTS = ['ACTIF', 'SUSPENDU', 'SUPPRIME'] as const;

class ConnexionConcepteurDto {
  @ApiProperty() @IsString() @Length(1, 60) identifiant: string;
  @ApiProperty() @IsString() @Length(1, 200) motDePasse: string;
  @ApiPropertyOptional({
    description: 'Code à 6 chiffres de l’application (double authentification).',
  })
  @IsOptional()
  @IsString()
  @Length(0, 10)
  code?: string;

  @ApiPropertyOptional({ type: AppareilDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppareilDto)
  appareil?: AppareilDto;

  @ApiPropertyOptional({ type: PreuveAppareilDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PreuveAppareilDto)
  preuve?: PreuveAppareilDto;

  @ApiPropertyOptional({
    example: 'ABCD-EFGH',
    description: 'Code d’autorisation du nouvel appareil.',
  })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  codeAppareil?: string;
}

class NouveauCommerceDto {
  @ApiProperty({ example: 'Adil Phone' }) @IsString() @Length(2, 80) commerce: string;
  @ApiProperty({ example: '+224620000000' })
  @Matches(/^\+\d{8,15}$/, { message: 'Téléphone au format international : +224620000000.' })
  telephone: string;
  @ApiProperty({ example: 'Adil Phone Madina' }) @IsString() @Length(2, 80) boutique: string;
  @ApiProperty({ example: 'MAD', description: 'Préfixe des factures (2 à 5 lettres).' })
  @Matches(/^[A-Za-z]{2,5}$/, { message: 'Préfixe : 2 à 5 lettres.' })
  prefixe: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) adresse?: string;
  @ApiProperty({ example: 'Adil Bangoura' }) @IsString() @Length(2, 80) proprietaire: string;
  @ApiProperty({ example: 'adil' })
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: 'Identifiant : 3 à 40 lettres, chiffres, . _ -' })
  identifiant: string;
  @ApiPropertyOptional({ description: 'Fin de l’abonnement payé.' })
  @IsOptional()
  @IsISO8601()
  abonnementJusquAu?: string;
}

class StatutDto {
  @ApiProperty({ enum: STATUTS }) @IsIn(STATUTS) statut: StatutCommerce;
  @ApiPropertyOptional({ description: 'Motif montré au commerçant.' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  motif?: string;
}

class AbonnementDto {
  @ApiProperty({ nullable: true, type: String })
  @ValidateIf((_, v) => v !== null)
  @IsISO8601()
  jusquAu: string | null;
}

const MOYENS = ['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'VIREMENT'] as const;

class PaiementDto {
  @ApiProperty({ enum: FORMULES_ABONNEMENT }) @IsIn(FORMULES_ABONNEMENT) formule: FormuleAbonnement;
  @ApiProperty({ description: 'Nombre de mois ou d’années payés.', minimum: 1, maximum: 24 })
  @IsInt()
  @Min(1)
  @Max(24)
  periodes: number;
  @ApiProperty({ enum: MOYENS }) @IsIn(MOYENS) moyen: MoyenPaiement;
  @ApiPropertyOptional({ description: 'Obligatoire sauf en espèces.' })
  @IsOptional()
  @IsString()
  @Length(0, 80)
  reference?: string;
  @ApiPropertyOptional({ description: 'Montant payé en GNF (par défaut : le tarif).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  montant?: number;
}

class BoutiqueDto {
  @ApiProperty() @IsString() @Length(2, 80) nom: string;
  @ApiProperty()
  @Matches(/^[A-Za-z]{2,5}$/, { message: 'Préfixe : 2 à 5 lettres.' })
  prefixe: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) adresse?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+\d{8,15}$/, { message: 'Téléphone au format international.' })
  telephone?: string;
}

class EtatBoutiqueDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() verrouillee?: boolean;
  @ApiPropertyOptional({ description: 'Vrai : retirer ; faux : restaurer.' })
  @IsOptional()
  @IsBoolean()
  supprimee?: boolean;
}

class FiltreCommercesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 80) recherche?: string;
  @ApiPropertyOptional({ enum: STATUTS }) @IsOptional() @IsIn(STATUTS) statut?: StatutCommerce;
}

/**
 * Espace concepteur (compte distinct des commerçants) : commerces abonnés, abonnements et
 * paiements, boutiques, verrouillage, retrait et restauration, catalogue de base.
 */
@ApiTags('Plateforme (concepteur)')
@Controller('plateforme')
export class PlateformeController {
  constructor(
    private readonly plateforme: PlateformeService,
    private readonly limiteur: LimiteurService,
  ) {}

  @Post('connexion')
  @Public()
  @HttpCode(200)
  @ApiOkResponse({
    description:
      'Jeton de session du concepteur (10 heures), ou { doubleAuth: true } si le code de l’application est requis.',
  })
  async connexion(@Body() dto: ConnexionConcepteurDto, @Ip() ip: string) {
    // Comme pour les commerçants : les échecs depuis une même IP sont limités.
    await this.limiteur.controler(LIMITES.connexionIp, ip);
    try {
      return await this.plateforme.connexion(dto.identifiant, dto.motDePasse, dto.code, {
        appareil: dto.appareil ?? { nom: 'Appareil du concepteur', plateforme: 'autre' },
        preuve: dto.preuve,
        codeAppareil: dto.codeAppareil,
      });
    } catch (erreur) {
      if (erreur instanceof UnauthorizedException) {
        await this.limiteur.verifier(LIMITES.connexionIp, ip);
      }
      throw erreur;
    }
  }

  @Get('tableau')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @ApiOkResponse({
    description: 'Commerces par état d’abonnement, encaissements (GNF), échéances.',
  })
  tableau() {
    return this.plateforme.tableau();
  }

  @Get('commerces')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  commerces(@Query() f: FiltreCommercesDto) {
    return this.plateforme.commerces(f.recherche, f.statut);
  }

  @Post('commerces')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Mot de passe provisoire du propriétaire, affiché une fois.' })
  creer(@ConcepteurCourant() c: ConcepteurConnecte, @Body() dto: NouveauCommerceDto) {
    return this.plateforme.creerCommerce(c, dto);
  }

  @Get('commerces/:id')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  commerce(@Param('id', ParseUUIDPipe) id: string) {
    return this.plateforme.commerce(id);
  }

  @Post('commerces/:id/statut')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  async statut(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StatutDto,
  ): Promise<void> {
    await this.plateforme.changerStatut(c, id, dto.statut, dto.motif ?? null);
  }

  @Patch('commerces/:id/abonnement')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  async abonnement(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AbonnementDto,
  ): Promise<void> {
    await this.plateforme.modifierAbonnement(c, id, dto.jusquAu);
  }

  @Post('commerces/:id/paiements')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Paiement enregistré et nouvelle échéance.' })
  paiement(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaiementDto,
  ) {
    return this.plateforme.enregistrerPaiement(c, id, dto);
  }

  @Post('commerces/:id/boutiques')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  ajouterBoutique(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BoutiqueDto,
  ) {
    return this.plateforme.ajouterBoutique(c, id, dto);
  }

  @Post('commerces/:id/catalogue')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Nombre d’éléments ajoutés au catalogue du commerce.' })
  catalogue(@ConcepteurCourant() c: ConcepteurConnecte, @Param('id', ParseUUIDPipe) id: string) {
    return this.plateforme.installerCatalogue(c, id);
  }

  @Post('commerces/:id/proprietaire/mot-de-passe')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Nouveau mot de passe provisoire, affiché une fois.' })
  motDePasse(@ConcepteurCourant() c: ConcepteurConnecte, @Param('id', ParseUUIDPipe) id: string) {
    return this.plateforme.reinitialiserProprietaire(c, id);
  }

  @Patch('boutiques/:id')
  @Public()
  @UseGuards(ConcepteurGuard)
  @ApiBearerAuth()
  @HttpCode(204)
  async boutique(
    @ConcepteurCourant() c: ConcepteurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EtatBoutiqueDto,
  ): Promise<void> {
    await this.plateforme.modifierBoutique(c, id, dto);
  }
}
