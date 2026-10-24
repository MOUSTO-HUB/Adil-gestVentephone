import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';
import type { UtilisateurConnecte } from '../auth/auth.types.js';
import { Roles, UtilisateurCourant } from '../auth/decorateurs.js';
import { Role } from '../generated/prisma/enums.js';
import { EquipeService } from './equipe.service.js';

const TELEPHONE = /^\+\d{8,15}$/;
const ROLES_EMPLOYE = ['GERANT', 'VENDEUR'] as const;

class NouvelleBoutiqueDto {
  @ApiProperty({ example: 'Adil Phone Kaloum' }) @IsString() @Length(2, 80) nom: string;
  @ApiProperty({ example: 'KAL', description: 'Préfixe des factures (2 à 5 lettres).' })
  @Matches(/^[A-Za-z]{2,5}$/, { message: 'Préfixe : 2 à 5 lettres.' })
  prefixe: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) adresse?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE, { message: 'Téléphone au format international : +224620000000.' })
  telephone?: string;
}

class ModificationBoutiqueDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) nom?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) adresse?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE, { message: 'Téléphone au format international.' })
  telephone?: string;
}

class BoutiqueCreeeDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty() prefixe: string;
}

class NouvelEmployeDto {
  @ApiProperty() @IsString() @Length(2, 80) nom: string;
  @ApiProperty({ example: 'aissatou' })
  @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: 'Identifiant : 3 à 40 lettres, chiffres, . _ -' })
  identifiant: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE, { message: 'Téléphone au format international.' })
  telephone?: string;
  @ApiProperty({ enum: ROLES_EMPLOYE }) @IsIn(ROLES_EMPLOYE) role: 'GERANT' | 'VENDEUR';
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Rattachez l’employé à au moins une boutique.' })
  @IsUUID('all', { each: true })
  boutiqueIds: string[];
}

class ModificationEmployeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) nom?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(TELEPHONE, { message: 'Téléphone au format international.' })
  telephone?: string;
  @ApiPropertyOptional({ enum: ROLES_EMPLOYE })
  @IsOptional()
  @IsIn(ROLES_EMPLOYE)
  role?: 'GERANT' | 'VENDEUR';
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Rattachez l’employé à au moins une boutique.' })
  @IsUUID('all', { each: true })
  boutiqueIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() actif?: boolean;
}

class EmployeDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty() identifiant: string;
  @ApiPropertyOptional({ nullable: true, type: String }) telephone: string | null;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() actif: boolean;
  @ApiProperty({ type: [String] }) boutiqueIds: string[];
  @ApiProperty({ description: 'Appareils connectés.' }) appareils: number;
  @ApiPropertyOptional({ nullable: true, type: String }) derniereConnexion: string | null;
}

class AccesProvisoireDto {
  @ApiProperty() identifiant: string;
  @ApiProperty({ description: 'Mot de passe provisoire, affiché une seule fois.' })
  motDePasse: string;
}

/** Boutiques et employés du commerce (le propriétaire gère, le gérant consulte son équipe). */
@ApiTags('Équipe et boutiques')
@ApiBearerAuth()
@Controller()
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}

  @Post('boutiques')
  @Roles(Role.PROPRIETAIRE)
  @ApiOkResponse({ type: BoutiqueCreeeDto })
  creerBoutique(@UtilisateurCourant() u: UtilisateurConnecte, @Body() dto: NouvelleBoutiqueDto) {
    return this.equipe.creerBoutique(u, dto);
  }

  @Patch('boutiques/:id')
  @Roles(Role.PROPRIETAIRE)
  @HttpCode(204)
  async modifierBoutique(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificationBoutiqueDto,
  ): Promise<void> {
    await this.equipe.modifierBoutique(u, id, dto);
  }

  @Get('employes')
  @Roles(Role.PROPRIETAIRE, Role.GERANT)
  @ApiOkResponse({ type: [EmployeDto] })
  employes(@UtilisateurCourant() u: UtilisateurConnecte) {
    return this.equipe.employes(u);
  }

  @Post('employes')
  @Roles(Role.PROPRIETAIRE)
  @ApiOkResponse({ type: AccesProvisoireDto })
  creerEmploye(@UtilisateurCourant() u: UtilisateurConnecte, @Body() dto: NouvelEmployeDto) {
    return this.equipe.creerEmploye(u, dto);
  }

  @Patch('employes/:id')
  @Roles(Role.PROPRIETAIRE)
  @HttpCode(204)
  async modifierEmploye(
    @UtilisateurCourant() u: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificationEmployeDto,
  ): Promise<void> {
    await this.equipe.modifierEmploye(u, id, dto);
  }

  @Post('employes/:id/mot-de-passe')
  @Roles(Role.PROPRIETAIRE)
  @HttpCode(200)
  @ApiOkResponse({ type: AccesProvisoireDto })
  motDePasse(@UtilisateurCourant() u: UtilisateurConnecte, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipe.reinitialiserMotDePasse(u, id);
  }
}
