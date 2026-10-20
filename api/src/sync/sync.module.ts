import { Global, Module } from '@nestjs/common';
import { JournalService } from './journal.service.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

/** Synchronisation des appareils ; JournalService sert à tous les modules qui modifient des données synchronisées. */
@Global()
@Module({
  controllers: [SyncController],
  providers: [SyncService, JournalService],
  exports: [JournalService],
})
export class SyncModule {}
