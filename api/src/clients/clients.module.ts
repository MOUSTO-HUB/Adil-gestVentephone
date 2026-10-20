import { Module } from '@nestjs/common';
import { StockageService } from '../stockage/stockage.service.js';
import { ClientsController } from './clients.controller.js';

@Module({
  controllers: [ClientsController],
  providers: [StockageService],
})
export class ClientsModule {}
