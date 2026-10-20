import { Module } from '@nestjs/common';
import { BoutiquesController } from './boutiques.controller.js';

@Module({
  controllers: [BoutiquesController],
})
export class BoutiquesModule {}
