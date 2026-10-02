import { Global, Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { CONFIG, loadConfig } from '../config';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './outbox/outbox.service';

/** Cross-cutting infrastructure available to every module. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [{ provide: CONFIG, useFactory: () => loadConfig() }, PrismaService, Clock, AuditService, OutboxService, AuthGuard],
  exports: [CONFIG, PrismaService, Clock, AuditService, OutboxService, AuthGuard],
})
export class CoreModule {}
