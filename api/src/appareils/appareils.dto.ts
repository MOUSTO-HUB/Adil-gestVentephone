import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '../generated/prisma/enums.js';

export class TitulaireAppareilDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty({ enum: Role }) role: Role;
}

export class AppareilDto {
  @ApiProperty() id: string;
  @ApiProperty() nom: string;
  @ApiProperty() plateforme: string;
  @ApiPropertyOptional({ type: Date }) dernierAcces: Date | null;
  @ApiProperty() creeLe: Date;
  @ApiProperty({ description: "L'appareil de la requête." }) courant: boolean;
  @ApiProperty({ type: TitulaireAppareilDto }) utilisateur: TitulaireAppareilDto;
}

export class ResultatDeconnexionDto {
  @ApiProperty({ description: "Nombre d'appareils déconnectés." }) appareils: number;
}
