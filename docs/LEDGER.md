# PayBridge — Ledger and Accounting Design

> **Educational Sandbox — No Real Money Movement.** The accounting model is a teaching representation, not audited accounting policy.

## 1. Principles

1. **Double entry.** Every financial event is one `ledger_transaction` with two or more `ledger_entries`. For each currency in the transaction, total debits equal total credits.
2. **Append only.** Entries and transactions are never updated or deleted. Mistakes and failures are corrected by posting a reversal that references the original.
3. **Balances are derived.** An account balance is the sum of its entries. `ledger_accounts.balance` is a cache maintained inside the posting transaction and continually verified.
4. **No balance changes without entries.** There is no code path that writes a balance other than the posting service.
5. **Exactly once.** Each posting carries a unique `posting_key`; a repeated attempt returns the existing transaction.

## 2. Currency precision

| Item | Storage | Scale used | Rounding |
|---|---|---|---|
| AED amounts | `NUMERIC(20,4)` | 2 dp | — |
| INR amounts | `NUMERIC(20,4)` | 2 dp | — |
| FX rates | `NUMERIC(20,8)` | 6 dp | down (truncate) for customer rate |
| Percentages | `NUMERIC(7,4)` | 4 dp | — |

Code uses `decimal.js` through a shared `Money` value object; JavaScript `number` is never used for money. API payloads carry amounts as strings (`"10000.00"`). The fourth decimal place in storage is headroom; a `CHECK` enforces that stored amounts have at most the currency's minor-unit scale.

## 3. FX quote formulas

Inputs: `base_amount` (AED), `mid_rate` (INR per AED), `spread_pct`, `fee_amount` (AED).

```
customer_rate     = truncate(mid_rate × (1 − spread_pct / 100), 6)
recipient_amount  = truncate(base_amount × customer_rate, 2)            [INR]
payout_cost_aed   = round_half_even(recipient_amount / mid_rate, 2)     [AED]
fx_margin_amount  = base_amount − payout_cost_aed                       [AED]
total_debit       = base_amount + fee_amount                            [AED]
```

Worked example (the canonical test vector):

```
base_amount      = 10,000.00 AED
mid_rate         = 22.700000
spread_pct       = 0.50
fee_amount       = 25.00 AED

customer_rate    = 22.70 × 0.995        = 22.586500
recipient_amount = 10,000 × 22.5865     = 225,865.00 INR
payout_cost_aed  = 225,865 / 22.70      = 9,950.00 AED
fx_margin_amount = 10,000 − 9,950       = 50.00 AED
total_debit      = 10,000 + 25          = 10,025.00 AED
```

Rounding always favours the platform by at most one minor unit (truncated rate, truncated payout). Because the margin is defined as a residual, `payout_cost_aed + fx_margin_amount = base_amount` holds exactly for any input — the AED side cannot fail to balance through rounding.

**Assumption A1:** the fee is charged on top of the send amount, as in the quote example of the brief.

## 4. Chart of accounts

| Code | Account | Type | Normal | Ccy | Scope | Meaning |
|---|---|---|---|---|---|---|
| 1000 | Safeguarding Bank AED | Asset | Debit | AED | System | Simulated bank balance backing customer wallets |
| 1200 | Nostro INR | Asset | Debit | INR | System | Simulated pre-funded INR at the payout partner |
| 1300 | FX Position INR | Asset | Debit | INR | System | INR sold to customers, not yet covered |
| 2000 | Customer Wallet AED | Liability | Credit | AED | Per company | Funds owed to the customer, available to spend |
| 2010 | Customer Payment Hold AED | Liability | Credit | AED | Per company | Customer funds reserved for in-flight payments |
| 2200 | INR Payout Payable | Liability | Credit | INR | System | INR owed to beneficiaries, captured but not yet paid out |
| 2300 | FX Position AED | Liability | Credit | AED | System | AED received against INR sold |
| 3000 | Sandbox Equity INR | Equity | Credit | INR | System | Offsets simulated nostro pre-funding |
| 4000 | Fee Revenue | Revenue | Credit | AED | System | Transfer fees earned |
| 4010 | FX Margin Revenue | Revenue | Credit | AED | System | Spread earned between mid and customer rate |

Debit increases debit-normal accounts and decreases credit-normal accounts. The customer wallet is a **liability** of the platform, so "debit the customer wallet" reduces what the customer has available — matching the brief's example.

The two FX position accounts are the bridge between currencies. After a capture they hold AED 9,950 (credit) and INR 225,865 (debit), which are equal in value at the mid rate. A real treasury function would square that position by buying INR; that is out of scope and noted in §10.

## 5. Posting rules

`posting_key` is `payment:{id}:{step}` (or `topup:{id}`), unique across the ledger.

### 5.1 Wallet top-up (sandbox) — `WALLET_TOPUP`
| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 1000 Safeguarding Bank AED | 100,000.00 AED |
| Cr | 2000 Customer Wallet AED | 100,000.00 AED |

### 5.2 Payment created — `PAYMENT_HOLD`
| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 2000 Customer Wallet AED | 10,025.00 AED |
| Cr | 2010 Customer Payment Hold AED | 10,025.00 AED |

Available balance falls immediately, so a second payment cannot spend the same funds. No revenue is recognised yet.

### 5.3 Payment enters PROCESSING — `PAYMENT_CAPTURE`
| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 2010 Customer Payment Hold AED | 10,025.00 AED |
| Cr | 4000 Fee Revenue | 25.00 AED |
| Cr | 4010 FX Margin Revenue | 50.00 AED |
| Cr | 2300 FX Position AED | 9,950.00 AED |
| Dr | 1300 FX Position INR | 225,865.00 INR |
| Cr | 2200 INR Payout Payable | 225,865.00 INR |

AED: 10,025 = 25 + 50 + 9,950. INR: 225,865 = 225,865. One transaction, balanced in each currency.

### 5.4 Provider confirms payout — `PAYOUT_SETTLEMENT`
| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 2200 INR Payout Payable | 225,865.00 INR |
| Cr | 1200 Nostro INR | 225,865.00 INR |

### 5.5 Cancelled before processing — `PAYMENT_HOLD_RELEASE`
| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 2010 Customer Payment Hold AED | 10,025.00 AED |
| Cr | 2000 Customer Wallet AED | 10,025.00 AED |

### 5.6 Provider reports failure after capture — `PAYMENT_REVERSAL`
Mirror of 5.3, returned straight to the wallet, with `reverses_transaction_id` pointing at the capture.

| Dr/Cr | Account | Amount |
|---|---|---|
| Dr | 4000 Fee Revenue | 25.00 AED |
| Dr | 4010 FX Margin Revenue | 50.00 AED |
| Dr | 2300 FX Position AED | 9,950.00 AED |
| Cr | 2000 Customer Wallet AED | 10,025.00 AED |
| Dr | 2200 INR Payout Payable | 225,865.00 INR |
| Cr | 1300 FX Position INR | 225,865.00 INR |

**Assumption:** a failed payment refunds the fee in full.

### 5.7 Refund simulation after PAID (P2) — `PAYOUT_RETURN`
If the provider later returns a paid payout, post the mirror of 5.4 (Dr Nostro INR / Cr Payout Payable) followed by 5.6. The original transactions stay untouched. The payment state machine would gain `PAID → RETURNED`; this is documented but not built in the MVP.

### 5.8 Nostro pre-funding (seed) — `NOSTRO_FUNDING`
Dr 1200 Nostro INR / Cr 3000 Sandbox Equity INR.

## 6. Ledger transactions by payment state

| Transition | Ledger posting | Posting key |
|---|---|---|
| → `CREATED` | 5.2 hold | `payment:{id}:hold` |
| `APPROVED → PROCESSING` | 5.3 capture | `payment:{id}:capture` |
| `PROCESSING → PAID` | 5.4 settlement | `payment:{id}:settle` |
| `PROCESSING → FAILED` | 5.6 reversal | `payment:{id}:reverse` |
| `CREATED / COMPLIANCE_REVIEW / APPROVED → CANCELLED` | 5.5 release | `payment:{id}:release` |

The state change and its posting happen in the same database transaction, so a payment's status and its ledger can never disagree after a commit.

## 7. Posting algorithm

```
post(transaction):
  1. validate: ≥ 2 entries; all amounts > 0; scale ≤ currency minor units
  2. validate: for each currency, Σ debits = Σ credits      → else LEDGER_IMBALANCE
  3. BEGIN (or join the caller's transaction)
  4. INSERT ledger_transactions (posting_key UNIQUE)
        on conflict → return the existing transaction (idempotent)
  5. SELECT … FROM ledger_accounts WHERE id IN (…) ORDER BY id FOR UPDATE
        (fixed ordering prevents deadlocks)
  6. for each entry: compute new balance; for customer accounts,
        new balance < 0 → INSUFFICIENT_FUNDS
  7. INSERT ledger_entries (with balance_after)
  8. UPDATE ledger_accounts SET balance, version = version + 1
  9. INSERT audit_logs (LEDGER_POSTED)
 10. COMMIT — deferred constraint trigger re-checks step 2 in the database
```

## 8. Balance calculation

```
balance(account) = Σ entries on the normal side − Σ entries on the other side
available(company) = balance(2000 Customer Wallet)
reserved(company)  = balance(2010 Customer Payment Hold)
```

`GET /ledger/:companyId/balance` returns both. The cached column is the read path; `SUM(ledger_entries)` is the truth and is compared in tests and in reconciliation.

## 9. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| L1 | Per transaction and currency, Σ debit = Σ credit | Service validation + deferred constraint trigger |
| L2 | Entry amounts are strictly positive | `CHECK (amount > 0)` |
| L3 | Entry currency equals account currency | Composite FK `(account_id, currency)` |
| L4 | Entries and transactions are immutable | `BEFORE UPDATE OR DELETE` trigger raises |
| L5 | Customer wallet and hold balances never go negative | Row lock + `CHECK (balance >= 0)` on customer-scoped accounts |
| L6 | Cached balance = Σ entries | Posting transaction; property test; reconciliation |
| L7 | One posting per `(payment, step)` | `UNIQUE (posting_key)` |
| L8 | Global trial balance is zero per currency | Test + admin endpoint |
| L9 | A reversal references exactly one original, and an original is reversed at most once | FK + `UNIQUE (reverses_transaction_id)` |
| L10 | Every hold is resolved by at most one of capture or release, never both, for the same amount | Reconciliation rule |

## 10. Accounting assumptions and simplifications

1. Revenue is recognised at capture (when the payout is submitted), and reversed if the payout fails. A stricter policy would defer it to settlement.
2. The FX position is left open; no treasury hedge or revaluation is modelled. Margin is booked at mid rate at capture time.
3. Safeguarding is one pooled account. There is no segregation per customer and no bank statement to reconcile it against.
4. No VAT on fees, no interest, no chargebacks, no provider fees or payout costs.
5. Nostro INR is pre-funded from a sandbox equity account purely so that the INR side has something to draw down.
6. AED and INR both use two decimal places; three-decimal currencies are out of scope.
