import { Module } from '@nestjs/common';
import { AppareilsController } from './appareils.controller.js';
import { AppareilsService } from './appareils.service.js';

@Module({
  controllers: [AppareilsController],
  providers: [AppareilsService],
})
export class AppareilsModule {}
