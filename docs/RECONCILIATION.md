# PayBridge — Reconciliation Architecture

> **Educational Sandbox — No Real Money Movement.**

## 1. Purpose

Prove, independently of the code paths that wrote the data, that three records of every payment agree:

```
Internal payment (payment_orders)  ↔  Provider record (provider_payments)  ↔  Ledger (ledger_transactions / entries)
```

Reconciliation is read-only. It never fixes anything; it reports, and a human decides.

## 2. Inputs

| Source | Read via | Notes |
|---|---|---|
| Internal | `payment_orders` in the period, plus any non-terminal payment older than the stuck threshold | |
| Provider | `PaymentProvider.listPayments(period)` on the mock → `provider_payments` | Accessed through the provider port, as a real statement or API would be |
| Ledger | `ledger_transactions` + `ledger_entries` by `payment_id` | Also global trial balance and cached-balance check |

The run executes inside one `REPEATABLE READ` read-only transaction so that all three sides are read from the same snapshot.

## 3. Matching

1. Group provider records by `payment_id`. Join to internal payments by id (and cross-check `provider_payment_id`).
2. For each internal payment, evaluate the checks below and collect reason codes.
3. Provider records with no internal payment produce their own items.
4. Run ledger-wide checks once per run.

### 3.1 Expected ledger per payment status

| Payment status | Postings that must exist | Must not exist |
|---|---|---|
| `CREATED`, `COMPLIANCE_REVIEW`, `APPROVED` | hold | capture, settle, release, reverse |
| `PROCESSING` | hold, capture | settle, release, reverse |
| `PAID` | hold, capture, settle | release, reverse |
| `FAILED` | hold, capture, reverse | settle, release |
| `CANCELLED` (after hold) | hold, release | capture, settle, reverse |
| `CANCELLED` (compliance reject at creation) | none | any |

### 3.2 Checks and resulting status

| Reason code | Condition | Item status |
|---|---|---|
| — | All checks pass | `MATCHED` |
| `PROVIDER_PAYMENT_MISSING` | Internal status ∈ {`PROCESSING`, `PAID`, `FAILED`} and no provider record | `MISSING` |
| `INTERNAL_PAYMENT_MISSING` | Provider record with unknown `payment_id` | `MISSING` |
| `LEDGER_ENTRY_MISSING` | A required posting from §3.1 is absent | `MISSING` |
| `AMOUNT_MISMATCH` | Provider amount/currency ≠ `destination_amount`/`destination_currency` | `MISMATCH` |
| `LEDGER_AMOUNT_MISMATCH` | Hold ≠ `total_debit_amount`, or capture INR leg ≠ `destination_amount` | `MISMATCH` |
| `STATUS_MISMATCH` | Internal and provider statuses disagree (mapping in §3.3) | `MISMATCH` |
| `PAID_BUT_PROVIDER_FAILED` | Internal `PAID`, provider `FAILED` | `MISMATCH` |
| `PROVIDER_PAID_INTERNAL_PROCESSING` | Provider `PAID`, internal still `PROCESSING` beyond the grace period (default 5 min) | `REVIEW_REQUIRED` |
| `UNEXPECTED_LEDGER_POSTING` | A posting from the "must not exist" column is present | `MISMATCH` |
| `LEDGER_IMBALANCE` | Any transaction of the payment has Σ debit ≠ Σ credit in a currency | `MISMATCH` |
| `DUPLICATE_PROVIDER_PAYMENT` | More than one provider record for one `payment_id` | `DUPLICATE` |
| `STUCK_IN_PROCESSING` | Internal `PROCESSING` older than the stuck threshold (default 30 min) | `REVIEW_REQUIRED` |
| `STUCK_AWAITING_SUBMISSION` | `APPROVED` older than the threshold (dead-lettered job) | `REVIEW_REQUIRED` |

Precedence when several codes apply: `DUPLICATE` > `MISMATCH` > `MISSING` > `REVIEW_REQUIRED` > `MATCHED`. All codes are kept in `reason_codes`.

### 3.3 Status mapping

| Internal | Acceptable provider status |
|---|---|
| `PROCESSING` | `CREATED`, `COMPLIANCE_REVIEW`, `PROCESSING` |
| `PAID` | `PAID` |
| `FAILED` | `FAILED` |
| `CREATED`, `COMPLIANCE_REVIEW`, `APPROVED`, `CANCELLED` | no provider record |

### 3.4 Ledger-wide checks (one item each, `payment_id` null)

| Reason code | Condition |
|---|---|
| `TRIAL_BALANCE_NONZERO` | Σ debits ≠ Σ credits for a currency across the whole ledger |
| `CACHED_BALANCE_DRIFT` | `ledger_accounts.balance` ≠ balance computed from entries |
| `ORPHAN_LEDGER_TRANSACTION` | Payment-type transaction whose `payment_id` does not exist |
| `HOLD_ACCOUNT_MISMATCH` | A company's hold balance ≠ Σ `total_debit_amount` of its payments in `CREATED`, `COMPLIANCE_REVIEW`, `APPROVED` |

`HOLD_ACCOUNT_MISMATCH` is the single most useful control: it ties an account balance to operational state without looking at individual postings.

## 4. Output

`reconciliation_runs` (period, counts, status) and one `reconciliation_items` row per payment or finding, with `internal_snapshot`, `provider_snapshot` and `ledger_snapshot` JSON capturing exactly what was compared, so a report stays meaningful after the underlying data moves on.

`GET /reports/reconciliation` — filters `date` or `from`/`to`, `status`, `paymentId`, `companyId`, `currency`, `runId`; defaults to the latest completed run. `POST /reports/reconciliation/run` enqueues a run and returns `202` with its id.

## 5. Scheduling and failure

- `RunReconciliation` repeatable job, hourly, over a rolling 48-hour window; manual runs take any period.
- A run that throws is marked `FAILED` with the error and retried per the job policy. Items are written in a single transaction after the read snapshot completes, so a failed run leaves no partial report.
- Runs are idempotent in effect: each produces a new, self-contained report.

## 6. Seeded examples

Seed data includes one deliberately broken payment so the report is never empty: internal `PAID`, provider `FAILED` (→ `MISMATCH`, `PAID_BUT_PROVIDER_FAILED`), plus one duplicate provider record (→ `DUPLICATE`). They are inserted directly by the seed script, bypassing the services — which is itself the point: reconciliation catches what the application could not have produced.

## 7. Resolution (documented, not automated)

| Finding | Operator action |
|---|---|
| `PROVIDER_PAID_INTERNAL_PROCESSING` | Replay the webhook from the admin screen (P1); the handler is idempotent |
| `PAID_BUT_PROVIDER_FAILED` | Investigate; correct with a `PAYOUT_RETURN` + reversal posting (P2) |
| `STUCK_*` | Re-drive the dead-lettered job |
| `CACHED_BALANCE_DRIFT` | Bug: fix cause; rebuild cache from entries |
