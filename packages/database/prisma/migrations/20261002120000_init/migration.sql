-- PayBridge — Educational Sandbox — No Real Money Movement.
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('PLATFORM', 'COMPANY');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "BeneficiaryStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'USED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'COMPLIANCE_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentComplianceStatus" AS ENUM ('CLEAR', 'REVIEW', 'REJECT', 'CLEARED_BY_ADMIN', 'REJECTED_BY_ADMIN');

-- CreateEnum
CREATE TYPE "PaymentApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('USER_CANCELLED', 'APPROVER_REJECTED', 'COMPLIANCE_REJECTED', 'KYB_REVOKED');

-- CreateEnum
CREATE TYPE "ComplianceRuleType" AS ENUM ('AMOUNT_THRESHOLD', 'VELOCITY', 'DESTINATION_COUNTRY', 'SANCTIONS', 'PEP');

-- CreateEnum
CREATE TYPE "ComplianceOutcome" AS ENUM ('CLEAR', 'REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalActionType" AS ENUM ('APPROVE', 'REJECT');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('WALLET_TOPUP', 'NOSTRO_FUNDING', 'PAYMENT_HOLD', 'PAYMENT_HOLD_RELEASE', 'PAYMENT_CAPTURE', 'PAYOUT_SETTLEMENT', 'PAYMENT_REVERSAL', 'PAYOUT_RETURN');

-- CreateEnum
CREATE TYPE "ProviderPaymentStatus" AS ENUM ('CREATED', 'COMPLIANCE_REVIEW', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING', 'DUPLICATE', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "platform_role_id" UUID,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "RoleScope" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "company_users" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "company_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "rotated_at" TIMESTAMPTZ(6),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "trade_license_number" TEXT NOT NULL,
    "trade_license_expiry" DATE NOT NULL,
    "registration_number" TEXT NOT NULL,
    "business_type" TEXT NOT NULL,
    "registered_address" TEXT NOT NULL,
    "contact_email" CITEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "website" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "maker_checker_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyb_profiles" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "KybStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "risk_level" "RiskLevel",
    "verification_result" JSONB,
    "rejection_reason" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "kyb_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyb_documents" (
    "id" UUID NOT NULL,
    "kyb_profile_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyb_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" CHAR(4) NOT NULL,
    "account_fingerprint" TEXT NOT NULL,
    "ifsc" CHAR(11) NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "status" "BeneficiaryStatus" NOT NULL DEFAULT 'ACTIVE',
    "screening_result" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "base_currency" CHAR(3) NOT NULL,
    "quote_currency" CHAR(3) NOT NULL,
    "base_amount" DECIMAL(20,4) NOT NULL,
    "mid_market_rate" DECIMAL(20,8) NOT NULL,
    "spread_percentage" DECIMAL(7,4) NOT NULL,
    "customer_rate" DECIMAL(20,8) NOT NULL,
    "fee_amount" DECIMAL(20,4) NOT NULL,
    "fx_margin_amount" DECIMAL(20,4) NOT NULL,
    "total_debit_amount" DECIMAL(20,4) NOT NULL,
    "recipient_amount" DECIMAL(20,4) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "beneficiary_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "source_currency" CHAR(3) NOT NULL,
    "source_amount" DECIMAL(20,4) NOT NULL,
    "destination_currency" CHAR(3) NOT NULL,
    "destination_amount" DECIMAL(20,4) NOT NULL,
    "fee_amount" DECIMAL(20,4) NOT NULL,
    "fx_margin_amount" DECIMAL(20,4) NOT NULL,
    "total_debit_amount" DECIMAL(20,4) NOT NULL,
    "exchange_rate" DECIMAL(20,8) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "compliance_status" "PaymentComplianceStatus" NOT NULL,
    "approval_status" "PaymentApprovalStatus" NOT NULL,
    "cancellation_reason" "CancellationReason",
    "failure_reason" TEXT,
    "purpose" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "created_by" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_status_history" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "from_status" "PaymentStatus",
    "to_status" "PaymentStatus" NOT NULL,
    "reason" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ComplianceRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parameters" JSONB NOT NULL,
    "outcome" "ComplianceOutcome" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "rule_id" UUID,
    "rule_code" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "outcome" "ComplianceOutcome" NOT NULL,
    "details" JSONB,
    "decided_by" UUID,
    "decision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" UUID NOT NULL,
    "approval_request_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" "ApprovalActionType" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normal_balance" "EntryDirection" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "posting_key" TEXT NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "company_id" UUID,
    "payment_id" UUID,
    "reverses_transaction_id" UUID,
    "description" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance_after" DECIMAL(20,4) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_payments" (
    "id" UUID NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "payment_id" UUID,
    "idempotency_key" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "ProviderPaymentStatus" NOT NULL,
    "scenario" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "payment_id" UUID,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "period_from" TIMESTAMPTZ(6) NOT NULL,
    "period_to" TIMESTAMPTZ(6) NOT NULL,
    "triggered_by" UUID,
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_items" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "company_id" UUID,
    "payment_id" UUID,
    "provider_payment_id" TEXT,
    "currency" CHAR(3),
    "status" "ReconciliationStatus" NOT NULL,
    "reason_codes" TEXT[],
    "internal_snapshot" JSONB,
    "provider_snapshot" JSONB,
    "ledger_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "company_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "company_users_user_id_idx" ON "company_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_users_company_id_user_id_key" ON "company_users"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_trade_license_number_key" ON "companies"("trade_license_number");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE INDEX "companies_created_at_idx" ON "companies"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "kyb_profiles_company_id_key" ON "kyb_profiles"("company_id");

-- CreateIndex
CREATE INDEX "kyb_profiles_status_idx" ON "kyb_profiles"("status");

-- CreateIndex
CREATE INDEX "kyb_documents_kyb_profile_id_idx" ON "kyb_documents"("kyb_profile_id");

-- CreateIndex
CREATE INDEX "beneficiaries_company_id_status_idx" ON "beneficiaries"("company_id", "status");

-- CreateIndex
CREATE INDEX "beneficiaries_company_id_created_at_idx" ON "beneficiaries"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_company_id_account_fingerprint_key" ON "beneficiaries"("company_id", "account_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiaries_id_company_id_key" ON "beneficiaries"("id", "company_id");

-- CreateIndex
CREATE INDEX "fx_quotes_company_id_created_at_idx" ON "fx_quotes"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "fx_quotes_status_expires_at_idx" ON "fx_quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "fx_quotes_id_company_id_key" ON "fx_quotes"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_reference_key" ON "payment_orders"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_quote_id_key" ON "payment_orders"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_provider_payment_id_key" ON "payment_orders"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");

-- CreateIndex
CREATE INDEX "payment_orders_company_id_created_at_idx" ON "payment_orders"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_orders_beneficiary_id_idx" ON "payment_orders"("beneficiary_id");

-- CreateIndex
CREATE INDEX "payment_orders_status_created_at_idx" ON "payment_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_company_id_idempotency_key_key" ON "payment_orders"("company_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_orders_quote_id_company_id_key" ON "payment_orders"("quote_id", "company_id");

-- CreateIndex
CREATE INDEX "payment_status_history_payment_id_created_at_idx" ON "payment_status_history"("payment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_rules_code_key" ON "compliance_rules"("code");

-- CreateIndex
CREATE INDEX "compliance_rules_enabled_idx" ON "compliance_rules"("enabled");

-- CreateIndex
CREATE INDEX "compliance_checks_payment_id_idx" ON "compliance_checks"("payment_id");

-- CreateIndex
CREATE INDEX "compliance_checks_company_id_created_at_idx" ON "compliance_checks"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "compliance_checks_outcome_idx" ON "compliance_checks"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_payment_id_key" ON "approval_requests"("payment_id");

-- CreateIndex
CREATE INDEX "approval_requests_company_id_status_idx" ON "approval_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "approval_actions_approval_request_id_idx" ON "approval_actions"("approval_request_id");

-- CreateIndex
CREATE INDEX "approval_actions_payment_id_idx" ON "approval_actions"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_company_id_idx" ON "ledger_accounts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_company_id_code_key" ON "ledger_accounts"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_id_currency_key" ON "ledger_accounts"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_posting_key_key" ON "ledger_transactions"("posting_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reverses_transaction_id_key" ON "ledger_transactions"("reverses_transaction_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_payment_id_idx" ON "ledger_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_company_id_created_at_idx" ON "ledger_transactions"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_type_created_at_idx" ON "ledger_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_payments_provider_payment_id_key" ON "provider_payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "provider_payments_payment_id_idx" ON "provider_payments"("payment_id");

-- CreateIndex
CREATE INDEX "provider_payments_status_idx" ON "provider_payments"("status");

-- CreateIndex
CREATE INDEX "provider_payments_created_at_idx" ON "provider_payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_event_id_key" ON "webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "webhook_events_payment_id_idx" ON "webhook_events"("payment_id");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_provider_payment_id_idx" ON "webhook_events"("provider_payment_id");

-- CreateIndex
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");

-- CreateIndex
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs"("status");

-- CreateIndex
CREATE INDEX "reconciliation_items_run_id_status_idx" ON "reconciliation_items"("run_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_items_payment_id_idx" ON "reconciliation_items"("payment_id");

-- CreateIndex
CREATE INDEX "reconciliation_items_company_id_created_at_idx" ON "reconciliation_items"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_company_id_created_at_idx" ON "audit_logs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_company_id_key_key" ON "idempotency_keys"("company_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_sequence_key" ON "outbox_events"("sequence");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_platform_role_id_fkey" FOREIGN KEY ("platform_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyb_profiles" ADD CONSTRAINT "kyb_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyb_profiles" ADD CONSTRAINT "kyb_profiles_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyb_documents" ADD CONSTRAINT "kyb_documents_kyb_profile_id_fkey" FOREIGN KEY ("kyb_profile_id") REFERENCES "kyb_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_quotes" ADD CONSTRAINT "fx_quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_beneficiary_id_company_id_fkey" FOREIGN KEY ("beneficiary_id", "company_id") REFERENCES "beneficiaries"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_quote_id_company_id_fkey" FOREIGN KEY ("quote_id", "company_id") REFERENCES "fx_quotes"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_status_history" ADD CONSTRAINT "payment_status_history_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "compliance_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_currency_fkey" FOREIGN KEY ("account_id", "currency") REFERENCES "ledger_accounts"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_payments" ADD CONSTRAINT "provider_payments_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "reconciliation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
