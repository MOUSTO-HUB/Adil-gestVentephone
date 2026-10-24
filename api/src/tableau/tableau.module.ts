import { Module } from '@nestjs/common';
import { StockageService } from '../stockage/stockage.service.js';
import { RapportsPlanifiesService } from './rapports-planifies.service.js';
import { TableauController } from './tableau.controller.js';
import { TableauService } from './tableau.service.js';

/** Tableau de bord consolidé et rapports planifiés. */
@Module({
  controllers: [TableauController],
  providers: [TableauService, RapportsPlanifiesService, StockageService],
})
export class TableauModule {}
