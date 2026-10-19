import { ApiProperty } from '@nestjs/swagger';

export class EtatSanteDto {
  @ApiProperty({ example: 'ok' })
  statut: 'ok';

  @ApiProperty({ example: 'adil-gestventephone-api' })
  service: string;
}
