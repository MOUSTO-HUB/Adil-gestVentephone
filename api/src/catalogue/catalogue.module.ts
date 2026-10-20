import { Module } from '@nestjs/common';
import { StockageService } from '../stockage/stockage.service.js';
import { CatalogueController } from './catalogue.controller.js';
import { ImportService } from './import.service.js';

@Module({
  controllers: [CatalogueController],
  providers: [ImportService, StockageService],
})
export class CatalogueModule {}
