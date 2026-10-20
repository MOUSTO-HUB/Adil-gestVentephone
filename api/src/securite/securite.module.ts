import { Global, Module } from '@nestjs/common';
import { LimiteurService } from './limiteur.service.js';

@Global()
@Module({
  providers: [LimiteurService],
  exports: [LimiteurService],
})
export class SecuriteModule {}
