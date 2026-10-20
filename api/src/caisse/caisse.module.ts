import { Module } from '@nestjs/common';
import { StockageService } from '../stockage/stockage.service.js';
import { DepensesController } from './depenses.controller.js';

@Module({
  controllers: [DepensesController],
  providers: [StockageService],
})
export class CaisseModule {}
