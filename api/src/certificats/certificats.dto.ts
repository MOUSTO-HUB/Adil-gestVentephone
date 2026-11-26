import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsString, Length, Matches } from 'class-validator';

/** Preuve de l'appareil : clé publique (JWK P-256) et défi du serveur signé. */
export class PreuveAppareilDto {
  @ApiProperty({
    description: 'Clé publique de l’appareil (JWK, courbe P-256).',
    example: { kty: 'EC', crv: 'P-256', x: '…', y: '…' },
  })
  @IsObject()
  cle: Record<string, unknown>;

  @ApiProperty({ description: 'Défi reçu de POST /auth/defi.' })
  @IsString()
  @Length(10, 2000)
  defi: string;

  @ApiProperty({ description: 'Signature ECDSA P-256 / SHA-256 du défi (r‖s, base64url).' })
  @Matches(/^[A-Za-z0-9_-]{80,100}$/, { message: 'Signature de l’appareil invalide.' })
  signature: string;
}

export class NouveauCodeDto {
  @ApiProperty({
    description:
      'Vrai : le nouvel appareil remplace les anciens (révoqués dès qu’il est enregistré) ; faux : appareil en plus.',
  })
  @IsBoolean()
  remplacer: boolean;
}

export class CodeAppareilDto {
  @ApiProperty({ example: 'ABCD-EFGH', description: 'Affiché une seule fois.' })
  code: string;
  @ApiProperty() expireLe: string;
  @ApiProperty() remplacer: boolean;
}
