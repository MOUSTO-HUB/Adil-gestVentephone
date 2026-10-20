import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { RapportsController } from './rapports.controller.js';
import { RapportsService } from './rapports.service.js';

@Module({
  controllers: [RapportsController, AuditController],
  providers: [RapportsService],
})
export class RapportsModule {}
