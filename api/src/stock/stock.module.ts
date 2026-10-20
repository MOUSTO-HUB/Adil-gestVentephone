import { Module } from '@nestjs/common';
import { ArticlesController } from './articles.controller.js';

@Module({
  controllers: [ArticlesController],
})
export class StockModule {}
