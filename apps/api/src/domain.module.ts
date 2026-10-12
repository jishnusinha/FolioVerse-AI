import { Global, Module } from '@nestjs/common';
import { AuditModule } from './common/audit.service';
import { CryptoModule } from './common/crypto.service';
import { PrismaModule } from './infra/prisma.service';
import { QueuesModule } from './infra/queues.service';
import { RedisModule } from './infra/redis.service';
import { StorageModule } from './infra/storage.service';
import { AiClientModule } from './modules/ai-client/ai-client.service';
import { EventsModule } from './modules/events/events.service';
import { IngestionExecutorService } from './modules/ingestion/ingestion-executor.service';
import { BudgetService } from './modules/ledger/budget.service';
import { LedgerService } from './modules/ledger/ledger.service';
import { MailModule } from './modules/mail/mail.service';
import { ModelsService } from './modules/models/models.service';
import { PurgeService } from './modules/maintenance/purge.service';
import { RunExecutorService } from './modules/runs/run-executor.service';
import { RunsService } from './modules/runs/runs.service';
import { SourcesService } from './modules/sources/sources.service';

const services = [
  BudgetService,
  LedgerService,
  ModelsService,
  RunsService,
  RunExecutorService,
  SourcesService,
  IngestionExecutorService,
  PurgeService,
];

/** Infrastructure and domain services shared by the HTTP and worker runtimes. */
@Global()
@Module({
  imports: [PrismaModule, RedisModule, StorageModule, QueuesModule, CryptoModule, AuditModule, MailModule, EventsModule, AiClientModule],
  providers: services,
  exports: services,
})
export class DomainModule {}
