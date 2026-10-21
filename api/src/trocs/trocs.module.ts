import { Module } from '@nestjs/common';
import { StockageService } from '../stockage/stockage.service.js';
import { TrocsController } from './trocs.controller.js';

@Module({
  controllers: [TrocsController],
  providers: [StockageService],
})
export class TrocsModule {}
