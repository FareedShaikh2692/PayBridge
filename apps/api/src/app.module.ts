import { CallHandler, ExecutionContext, Injectable, MiddlewareConsumer, Module, NestInterceptor, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Observable, finalize } from 'rxjs';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter, EnvelopeInterceptor, RequestContextMiddleware } from './common/http';
import { RateLimitStorage } from './common/throttler.storage';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { BeneficiariesController } from './modules/beneficiaries/beneficiaries.controller';
import { BeneficiariesRepository } from './modules/beneficiaries/beneficiaries.repository';
import { BeneficiariesService } from './modules/beneficiaries/beneficiaries.service';
import { CompaniesController } from './modules/companies/companies.controller';
import { CompaniesService } from './modules/companies/companies.service';
import { ComplianceController, ComplianceService } from './modules/compliance/compliance.controller';
import { ComplianceEngine } from './modules/compliance/compliance.engine';
import { MockSanctionsProvider, SanctionsProvider } from './modules/compliance/sanctions.provider';
import { CoreModule } from './modules/core.module';
import { DashboardController, DashboardService } from './modules/dashboard/dashboard';
import { FxController } from './modules/fx/fx.controller';
import { FxService, MockRateProvider, RateProvider } from './modules/fx/fx.service';
import { KybController } from './modules/kyb/kyb.controller';
import { KybProvider, MockKYBProvider } from './modules/kyb/kyb.provider';
import { KybService } from './modules/kyb/kyb.service';
import { LedgerController } from './modules/ledger/ledger.controller';
import { LedgerService } from './modules/ledger/ledger.service';
import { HealthController, OpsController } from './modules/ops/ops';
import { OutboxService } from './modules/outbox/outbox.service';
import { PaymentsController } from './modules/payments/payments.controller';
import { PaymentsRepository } from './modules/payments/payments.repository';
import { PaymentsService } from './modules/payments/payments.service';
import { MockPaymentProvider, PaymentProvider, ProviderSubmissionService, SandboxProviderController } from './modules/provider/provider';
import { ReconciliationController } from './modules/reconciliation/reconciliation.controller';
import { ReconciliationService } from './modules/reconciliation/reconciliation.service';
import { SandboxController } from './modules/sandbox/sandbox.controller';
import { WebhooksController, WebhooksService } from './modules/webhooks/webhooks';

// ── Feature modules. Dependencies point one way: ledger ← kyb ← fx/payments ← webhooks/reconciliation. ──

@Module({ providers: [LedgerService], controllers: [LedgerController], exports: [LedgerService] })
export class LedgerModule {}

@Module({ imports: [LedgerModule], providers: [KybService, { provide: KybProvider, useClass: MockKYBProvider }], controllers: [KybController, SandboxController], exports: [KybService] })
export class KybModule {}

@Module({ providers: [AuthService], controllers: [AuthController], exports: [AuthService] })
export class AuthModule {}

@Module({ imports: [KybModule, AuthModule], providers: [CompaniesService], controllers: [CompaniesController] })
export class CompaniesModule {}

@Module({ providers: [ComplianceEngine, { provide: SanctionsProvider, useClass: MockSanctionsProvider }], exports: [ComplianceEngine] })
export class ComplianceEngineModule {}

@Module({ imports: [ComplianceEngineModule], providers: [BeneficiariesService, BeneficiariesRepository], controllers: [BeneficiariesController] })
export class BeneficiariesModule {}

@Module({ imports: [KybModule], providers: [FxService, { provide: RateProvider, useClass: MockRateProvider }], controllers: [FxController], exports: [FxService] })
export class FxModule {}

@Module({ imports: [LedgerModule, KybModule, ComplianceEngineModule], providers: [PaymentsService, PaymentsRepository], controllers: [PaymentsController], exports: [PaymentsService, PaymentsRepository] })
export class PaymentsModule {}

@Module({ imports: [PaymentsModule, ComplianceEngineModule], providers: [ComplianceService], controllers: [ComplianceController] })
export class ComplianceModule {}

@Module({ providers: [{ provide: PaymentProvider, useClass: MockPaymentProvider }, ProviderSubmissionService], controllers: [SandboxProviderController], exports: [PaymentProvider] })
export class ProviderModule {}

@Module({ imports: [PaymentsModule], providers: [WebhooksService], controllers: [WebhooksController] })
export class WebhooksModule {}

@Module({ imports: [ProviderModule, LedgerModule], providers: [ReconciliationService], controllers: [ReconciliationController], exports: [ReconciliationService] })
export class ReconciliationModule {}

@Module({ imports: [LedgerModule, FxModule, PaymentsModule], providers: [DashboardService], controllers: [DashboardController] })
export class DashboardModule {}

@Module({ imports: [FxModule, KybModule], controllers: [HealthController, OpsController] })
export class OpsModule {}

/** After any state-changing request, nudge the outbox so follow-up work starts without waiting for a poll. */
@Injectable()
export class OutboxKickInterceptor implements NestInterceptor {
  constructor(private readonly outbox: OutboxService) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method = context.switchToHttp().getRequest().method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();
    return next.handle().pipe(finalize(() => this.outbox.kick()));
  }
}

@Module({
  imports: [
    CoreModule,
    DiscoveryModule,
    ThrottlerModule.forRootAsync({
      inject: [RateLimitStorage],
      useFactory: (storage: RateLimitStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
        storage,
        skipIf: () => process.env.RATE_LIMIT_DISABLED === 'true',
      }),
    }),
    LedgerModule,
    KybModule,
    AuthModule,
    CompaniesModule,
    ComplianceEngineModule,
    BeneficiariesModule,
    FxModule,
    PaymentsModule,
    ComplianceModule,
    ProviderModule,
    WebhooksModule,
    ReconciliationModule,
    DashboardModule,
    OpsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: OutboxKickInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*path}');
  }
}
