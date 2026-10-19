import { Module } from '@nestjs/common';
import { SanteController } from './sante.controller.js';

@Module({
  controllers: [SanteController],
})
export class SanteModule {}
