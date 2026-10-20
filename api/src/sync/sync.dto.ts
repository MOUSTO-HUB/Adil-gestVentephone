import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TAILLE_LOT_MAX, type TypeOperation, TYPES_OPERATIONS } from '@gestvente/commun';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class OperationDto {
  @ApiProperty({ description: "UUID généré sur l'appareil (clé d'idempotence)." })
  @IsUUID()
  id: string;

  @ApiProperty({ enum: TYPES_OPERATIONS })
  @IsIn(TYPES_OPERATIONS)
  type: TypeOperation;

  @ApiProperty()
  @IsUUID()
  boutiqueId: string;

  @ApiProperty({ description: "Date de l'opération sur l'appareil (ISO 8601)." })
  @IsISO8601({ strict: true })
  faiteLe: string;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'Selon le type.' })
  @IsObject()
  contenu: Record<string, unknown>;
}

export class LotOperationsDto {
  @ApiProperty({ type: [OperationDto], maxItems: TAILLE_LOT_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TAILLE_LOT_MAX)
  @ValidateNested({ each: true })
  @Type(() => OperationDto)
  operations: OperationDto[];
}

export class ChangementDto {
  @ApiProperty() seq: number;
  @ApiProperty() entite: string;
  @ApiProperty() id: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  donnees: Record<string, unknown> | null;
}

export class ResultatOperationDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['APPLIQUEE', 'REJETEE', 'CONFLIT'] }) statut: string;
  @ApiPropertyOptional() motif?: string;
  @ApiPropertyOptional({ type: [ChangementDto] }) corrections?: ChangementDto[];
}

export class ResultatLotDto {
  @ApiProperty({ type: [ResultatOperationDto] }) resultats: ResultatOperationDto[];
}

export class RequeteChangementsDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  curseur = 0;

  @ApiPropertyOptional({ default: 500, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limite = 500;
}

export class PageChangementsDto {
  @ApiProperty({ type: [ChangementDto] }) changements: ChangementDto[];
  @ApiProperty() curseur: number;
  @ApiProperty({ description: 'Redemander avec le nouveau curseur.' }) plus: boolean;
}

export class InstantaneDto {
  @ApiProperty() curseur: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'object' } },
    description:
      'Listes par entité : marque, modele, categorie, produit, prixBoutique, compatibilite, stock, article.',
  })
  donnees: Record<string, unknown[]>;
}

export class UtilisateurConflitDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
}

export class ConflitDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: TYPES_OPERATIONS }) type: string;
  @ApiProperty() libelle: string;
  @ApiPropertyOptional({ nullable: true, type: String }) boutiqueId: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) motif: string | null;
  @ApiProperty() faiteLe: Date;
  @ApiProperty() recueLe: Date;
  @ApiProperty({ type: 'object', additionalProperties: true }) contenu: unknown;
  @ApiPropertyOptional({ type: UtilisateurConflitDto, nullable: true })
  utilisateur: UtilisateurConflitDto | null;
}
