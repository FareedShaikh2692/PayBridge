-- Integrity rules Prisma cannot express. See docs/DATABASE.md §5 and docs/LEDGER.md §9.

-- ── Amount checks ────────────────────────────────────────────────────────────
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_positive CHECK (amount > 0);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_scale CHECK (amount = round(amount, 2));

ALTER TABLE fx_quotes ADD CONSTRAINT fx_quotes_amounts_positive
  CHECK (base_amount > 0 AND recipient_amount > 0 AND fee_amount >= 0 AND fx_margin_amount >= 0 AND customer_rate > 0 AND mid_market_rate > 0);
ALTER TABLE fx_quotes ADD CONSTRAINT fx_quotes_total CHECK (total_debit_amount = base_amount + fee_amount);
ALTER TABLE fx_quotes ADD CONSTRAINT fx_quotes_expiry_after_creation CHECK (expires_at > created_at);
ALTER TABLE fx_quotes ADD CONSTRAINT fx_quotes_scale
  CHECK (base_amount = round(base_amount, 2) AND recipient_amount = round(recipient_amount, 2) AND fee_amount = round(fee_amount, 2));

ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_amounts_positive
  CHECK (source_amount > 0 AND destination_amount > 0 AND fee_amount >= 0 AND fx_margin_amount >= 0);
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_total CHECK (total_debit_amount = source_amount + fee_amount);

ALTER TABLE provider_payments ADD CONSTRAINT provider_payments_amount_positive CHECK (amount > 0);

-- Customer-scoped accounts (wallet, hold) can never go negative.
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_customer_non_negative
  CHECK (company_id IS NULL OR balance >= 0);

-- System accounts: exactly one per chart-of-accounts code (NULLs are distinct in the Prisma unique index).
CREATE UNIQUE INDEX ledger_accounts_system_code ON ledger_accounts (code) WHERE company_id IS NULL;

-- ── Immutability ─────────────────────────────────────────────────────────────
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_transactions_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_status_history_immutable BEFORE UPDATE OR DELETE ON payment_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER approval_actions_immutable BEFORE UPDATE OR DELETE ON approval_actions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER compliance_checks_immutable BEFORE UPDATE OR DELETE ON compliance_checks
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A quote's price can never change after issue; only status and used_at may move.
CREATE FUNCTION fx_quotes_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: quotes cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.company_id, NEW.base_currency, NEW.quote_currency, NEW.base_amount, NEW.mid_market_rate,
      NEW.spread_percentage, NEW.customer_rate, NEW.fee_amount, NEW.fx_margin_amount,
      NEW.total_debit_amount, NEW.recipient_amount, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.company_id, OLD.base_currency, OLD.quote_currency, OLD.base_amount, OLD.mid_market_rate,
      OLD.spread_percentage, OLD.customer_rate, OLD.fee_amount, OLD.fx_margin_amount,
      OLD.total_debit_amount, OLD.recipient_amount, OLD.created_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: priced columns of a quote cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'ACTIVE' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION: quote % is %', OLD.id, OLD.status USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER fx_quotes_guard BEFORE UPDATE OR DELETE ON fx_quotes
  FOR EACH ROW EXECUTE FUNCTION fx_quotes_guard();

-- A payment's money can never change after creation.
CREATE FUNCTION payment_orders_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: payments cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.company_id, NEW.beneficiary_id, NEW.quote_id, NEW.source_currency, NEW.source_amount,
      NEW.destination_currency, NEW.destination_amount, NEW.fee_amount, NEW.fx_margin_amount,
      NEW.total_debit_amount, NEW.exchange_rate, NEW.idempotency_key, NEW.created_by)
     IS DISTINCT FROM
     (OLD.company_id, OLD.beneficiary_id, OLD.quote_id, OLD.source_currency, OLD.source_amount,
      OLD.destination_currency, OLD.destination_amount, OLD.fee_amount, OLD.fx_margin_amount,
      OLD.total_debit_amount, OLD.exchange_rate, OLD.idempotency_key, OLD.created_by) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: financial columns of a payment cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_orders_guard BEFORE UPDATE OR DELETE ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION payment_orders_guard();

-- ── Double entry: every transaction balances per currency, verified at COMMIT ─
CREATE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ledger_entries
    WHERE transaction_id = NEW.transaction_id
    GROUP BY currency
    HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0
  ) THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCE: transaction % does not balance', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM ledger_entries WHERE transaction_id = NEW.transaction_id) < 2 THEN
    RAISE EXCEPTION 'LEDGER_IMBALANCE: transaction % has fewer than two entries', NEW.transaction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();
