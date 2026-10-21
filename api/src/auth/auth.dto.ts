import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';

export const PLATEFORMES = ['android', 'ios', 'web', 'windows', 'macos', 'autre'] as const;

export class AppareilDto {
  @ApiProperty({ example: 'Samsung A15 de la caisse' })
  @IsString()
  @Length(1, 80)
  nom: string;

  @ApiProperty({ enum: PLATEFORMES })
  @IsIn(PLATEFORMES)
  plateforme: (typeof PLATEFORMES)[number];
}

export class ConnexionDto {
  @ApiProperty({ example: 'vendeur1' })
  @IsString()
  @Length(1, 60)
  identifiant: string;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  motDePasse: string;

  @ApiProperty({ type: AppareilDto })
  @ValidateNested()
  @Type(() => AppareilDto)
  appareil: AppareilDto;
}

export class RafraichissementDto {
  @ApiProperty()
  @IsString()
  @Length(10, 300)
  jetonRafraichissement: string;
}

export class DefinirPinDto {
  @ApiProperty({ example: '2580', description: '4 à 6 chiffres, pas trop facile à deviner.' })
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'Le code PIN doit contenir de 4 à 6 chiffres.' })
  pin: string;

  @ApiPropertyOptional({ description: 'Exigé pour changer un code PIN déjà défini.' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  motDePasse?: string;
}

export class VerifierPinDto {
  @ApiProperty({ example: '2580' })
  @IsString()
  @Length(1, 6)
  pin: string;
}

export class UtilisateurSessionDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() commerceId: string;
}

export class SessionDto {
  @ApiProperty({ description: "Jeton d'accès (15 minutes)." })
  jetonAcces: string;

  @ApiProperty({ description: 'Jeton de rafraîchissement (30 jours, à usage unique).' })
  jetonRafraichissement: string;

  @ApiProperty() appareilId: string;

  @ApiProperty({ type: UtilisateurSessionDto })
  utilisateur: UtilisateurSessionDto;
}

export class BoutiqueResumeDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty() prefixe: string;
  @ApiPropertyOptional() adresse: string | null;
  @ApiPropertyOptional({ description: 'Imprimé sur les factures et reçus.' })
  telephone: string | null;
}

export class CommerceResumeDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty({ example: 'GNF' }) monnaie: string;
  @ApiProperty({ example: '+224' }) indicatif: string;
  @ApiProperty({ example: 'Africa/Conakry', description: 'Fuseau des dates imprimées.' })
  fuseau: string;
  @ApiProperty() remiseMaxVendeur: number;
  @ApiProperty() remiseMaxGerant: number;
  @ApiProperty({ description: 'Délai de retour ou d’échange (jours après la vente).' })
  delaiRetourJours: number;
  @ApiProperty({
    description: 'Hausse maximale (%) de la valeur de reprise accordée par un vendeur.',
  })
  repriseMaxVendeur: number;
}

export class ProfilDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty() identifiant: string;
  @ApiProperty({ enum: Role }) role: Role;
  @ApiProperty() appareilId: string;
  @ApiProperty({ description: 'Un code PIN est défini pour ce compte.' }) pinDefini: boolean;
  @ApiProperty({
    description: 'Plus grand numéro d’ordre de facture de cet appareil (reprise du compteur).',
  })
  dernierOrdreFacture: number;
  @ApiProperty({ type: CommerceResumeDto }) commerce: CommerceResumeDto;
  @ApiProperty({ type: [BoutiqueResumeDto] }) boutiques: BoutiqueResumeDto[];
}

export class ResultatPinDto {
  @ApiProperty() valide: boolean;
}
