'use client';

import { AMOUNT_REGEX } from '@paybridge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Card, Empty, ErrorNote, Loading, Money, PageHeader, Rows, StatusBadge } from '@/components/ui';
import { ApiError, api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatAmount } from '@/lib/format';
import type { Balance, Beneficiary, DashboardSummary, PaymentDetail, Quote } from '@/lib/types';

interface Preview {
  result: 'CLEAR' | 'REVIEW' | 'REJECT';
  approvalRequired: boolean;
  rules: { ruleCode: string; ruleName: string; triggered: boolean; outcome: string }[];
}

const STEPS = ['Beneficiary', 'Amount', 'Quote', 'Compliance', 'Review', 'Submitted'];

/** Seconds left on a quote, measured against the server's clock rather than the browser's. */
function useCountdown(quote: Quote | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!quote) return;
    const skew = new Date(quote.serverTime).getTime() - Date.now(); // captured when the quote arrived
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - (Date.now() + skew)) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [quote]);
  return left;
}

function Countdown({ seconds, total }: { seconds: number; total: number }) {
  const expired = seconds <= 0;
  const urgent = seconds <= 10;
  return (
    <div data-testid="quote-countdown" data-seconds={seconds} className={clsx('rounded-md border px-3 py-2', expired ? 'border-bad/30 bg-bad-soft' : urgent ? 'border-warn/30 bg-warn-soft' : 'border-surface-line bg-surface-sunken')}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-ink-muted">{expired ? 'Quote expired' : 'Rate locked for'}</span>
        <span className={clsx('num text-lg font-semibold', expired ? 'text-bad' : urgent ? 'text-warn' : 'text-ink')} aria-live={urgent ? 'polite' : 'off'}>
          {expired ? '0s' : `${seconds}s`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-line" aria-hidden="true">
        <div className={clsx('h-full rounded-full transition-[width] duration-200', expired ? 'bg-bad' : urgent ? 'bg-warn' : 'bg-accent')} style={{ width: `${Math.min(100, (seconds / total) * 100)}%` }} />
      </div>
    </div>
  );
}

function Wizard() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const preselected = useSearchParams().get('beneficiaryId');
  const [step, setStep] = useState(1);
  const [beneficiaryId, setBeneficiaryId] = useState<string | null>(preselected);
  const [amount, setAmount] = useState('10000.00');
  const [purpose, setPurpose] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  // One idempotency key per quote: a double click or a retry after a network error can never create two payments.
  const keys = useRef(new Map<string, string>());
  const seconds = useCountdown(quote);
  const expired = Boolean(quote) && seconds <= 0;

  const companyId = me?.company?.id;
  const beneficiaries = useQuery({ queryKey: ['beneficiaries', 'active'], queryFn: () => api.page<Beneficiary>(`/beneficiaries${qs({ status: 'ACTIVE', pageSize: 100, sort: 'name:asc' })}`) });
  const balance = useQuery({ queryKey: ['balance', companyId], queryFn: () => api.get<Balance>(`/ledger/${companyId}/balance`), enabled: Boolean(companyId) });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api.get<DashboardSummary['fx']>('/fx/rates') });
  const beneficiary = useMemo(() => beneficiaries.data?.items.find((b) => b.id === beneficiaryId) ?? null, [beneficiaries.data, beneficiaryId]);

  const amountError = !AMOUNT_REGEX.test(amount) ? 'Enter an amount with at most two decimal places, e.g. 10000.00' : null;

  const getQuote = useMutation({
    mutationFn: () => api.post<Quote>('/fx/quotes', { baseCurrency: 'AED', quoteCurrency: 'INR', baseAmount: amount }),
    onSuccess: (q) => {
      setQuote(q);
      setPreview(null);
      setStep(3);
    },
  });
  const runPreview = useMutation({
    mutationFn: () => api.post<Preview>('/compliance/preview', { beneficiaryId, baseAmount: quote!.baseAmount }),
    onSuccess: (p) => {
      setPreview(p);
      setStep(4);
    },
  });
  const submit = useMutation({
    mutationFn: () => {
      if (!keys.current.has(quote!.id)) keys.current.set(quote!.id, crypto.randomUUID());
      return api.post<PaymentDetail>('/payments', { quoteId: quote!.id, beneficiaryId, purpose: purpose.trim() || undefined, sourceAmount: quote!.baseAmount }, { idempotencyKey: keys.current.get(quote!.id) });
    },
    onSuccess: (p) => {
      setPayment(p);
      setStep(6);
      qc.invalidateQueries();
    },
  });

  if (me?.company && me.company.kybStatus !== 'APPROVED') {
    return (
      <Alert tone="warn" title="KYB approval is required before sending payments">
        This company's KYB is {me.company.kybStatus.toLowerCase().replace('_', ' ')}. <Link className="link" href="/company/kyb">Go to KYB</Link>
      </Alert>
    );
  }

  const quoteExpiredError = submit.error instanceof ApiError && submit.error.code === 'QUOTE_EXPIRED';
  const estimated = !preview
    ? '—'
    : preview.result === 'REJECT'
      ? 'Will be rejected by compliance and cancelled. No funds are reserved.'
      : preview.result === 'REVIEW'
        ? `Compliance review by the platform${preview.approvalRequired ? ', and approval by a second user' : ''}, then processing.`
        : preview.approvalRequired
          ? 'Awaiting approval by a second user, then processing.'
          : 'Processed immediately.';

  const quotePanel = quote && (
    <div className="space-y-3">
      <Countdown seconds={seconds} total={rates.data?.quoteTtlSeconds ?? 60} />
      <Rows
        items={[
          ['AED amount', <Money key="a" value={quote.baseAmount} currency="AED" />],
          ['FX rate', <span key="r" className="num" data-testid="quote-rate">1 AED = {quote.customerRate} INR</span>],
          ['Spread', <span key="s" className="num">{quote.spreadPercentage}% <span className="text-ink-faint">(mid {quote.midMarketRate})</span></span>],
          ['Fee', <Money key="f" value={quote.feeAmount} currency="AED" />],
          ['Total debit', <Money key="t" value={quote.totalDebitAmount} currency="AED" strong />],
          ['Recipient INR amount', <span key="i" data-testid="quote-recipient"><Money value={quote.recipientAmount} currency="INR" strong /></span>],
        ]}
      />
    </div>
  );

  const requote = (
    <Alert tone="bad" title="This quote has expired" testId="quote-expired">
      A quote cannot be used after 60 seconds.{' '}
      <button className="link" onClick={() => getQuote.mutate()} disabled={getQuote.isPending}>
        {getQuote.isPending ? 'Getting a new quote…' : 'Get a new quote for the same amount'}
      </button>
    </Alert>
  );

  return (
    <>
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          return (
            <li key={label} aria-current={step === n ? 'step' : undefined} className={clsx('flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium', step === n ? 'border-accent bg-accent text-white' : step > n ? 'border-accent/40 bg-accent-soft text-accent' : 'border-surface-line bg-surface text-ink-faint')}>
              <span className="num">{n}</span> {label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {step === 1 && (
            <Card title="Step 1 — Select beneficiary" actions={<Link href="/beneficiaries/new?returnTo=payment" className="link text-xs">Add a new beneficiary</Link>} padded={false}>
              {beneficiaries.isLoading ? (
                <Loading />
              ) : !beneficiaries.data?.items.length ? (
                <Empty title="No active beneficiaries"><Link className="link" href="/beneficiaries/new?returnTo=payment">Add one to continue</Link></Empty>
              ) : (
                <fieldset>
                  <legend className="sr-only">Beneficiary</legend>
                  <ul className="divide-y divide-surface-line">
                    {beneficiaries.data.items.map((b) => (
                      <li key={b.id}>
                        <label className={clsx('flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-sunken', beneficiaryId === b.id && 'bg-accent-soft')}>
                          <input type="radio" name="beneficiary" className="h-4 w-4" checked={beneficiaryId === b.id} onChange={() => setBeneficiaryId(b.id)} />
                          <span className="flex-1">
                            <span className="font-medium">{b.name}</span>
                            <span className="block text-xs text-ink-muted">{b.bankName} · <span className="num">{b.accountNumberMasked}</span> · <span className="num">{b.ifsc}</span></span>
                          </span>
                          {b.screeningResult === 'PEP_MATCH' && <StatusBadge value="PEP_MATCH" label="PEP — review" />}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              <div className="flex justify-end border-t border-surface-line p-3">
                <button className="btn-primary" disabled={!beneficiary} onClick={() => setStep(2)}>Continue</button>
              </div>
            </Card>
          )}

          {step === 2 && (
            <Card title="Step 2 — Enter amount">
              <label className="label" htmlFor="amount">You send (AED)</label>
              <div className="flex items-center gap-2">
                <span className="text-ink-muted">AED</span>
                <input id="amount" className="input num max-w-xs text-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} aria-invalid={Boolean(amountError)} aria-describedby="amount-help" />
              </div>
              <p id="amount-help" className={clsx('mt-1 text-xs', amountError ? 'font-medium text-bad' : 'text-ink-faint')}>
                {amountError ?? (rates.data ? `Between AED ${formatAmount(rates.data.minAmount)} and AED ${formatAmount(rates.data.maxAmount)}. A fee of AED ${formatAmount(rates.data.feeAmount)} is added on top.` : ' ')}
              </p>
              <ErrorNote error={getQuote.error} />
              <div className="mt-4 flex justify-between">
                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" disabled={Boolean(amountError) || getQuote.isPending} onClick={() => getQuote.mutate()}>
                  {getQuote.isPending ? 'Getting quote…' : 'Get quote'}
                </button>
              </div>
            </Card>
          )}

          {step === 3 && quote && (
            <Card title="Step 3 — Your quote">
              {quotePanel}
              {expired && <div className="mt-3">{requote}</div>}
              <ErrorNote error={runPreview.error ?? getQuote.error} />
              <div className="mt-4 flex justify-between">
                <button className="btn-secondary" onClick={() => setStep(2)}>Change amount</button>
                <button className="btn-primary" disabled={expired || runPreview.isPending} onClick={() => runPreview.mutate()}>
                  {runPreview.isPending ? 'Checking…' : 'Continue'}
                </button>
              </div>
            </Card>
          )}

          {step === 4 && preview && (
            <Card title="Step 4 — Compliance preview">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-ink-muted">Expected outcome</span>
                <StatusBadge value={preview.result} testId="compliance-preview" label={preview.result === 'CLEAR' ? 'Clear' : preview.result === 'REVIEW' ? 'Review required' : 'Will be rejected'} />
              </div>
              <table className="table">
                <thead>
                  <tr><th>Rule</th><th>Result</th></tr>
                </thead>
                <tbody>
                  {preview.rules.map((r) => (
                    <tr key={r.ruleCode}>
                      <td>{r.ruleName}</td>
                      <td>{r.triggered ? <StatusBadge value={r.outcome} label={r.outcome === 'REVIEW' ? 'Triggered — review' : 'Triggered — reject'} /> : <StatusBadge value="CLEAR" label="Not triggered" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-faint">A preview only. The rules run again, and are recorded, when the payment is created. Screening uses a mock provider.</p>
              {expired && <div className="mt-3">{requote}</div>}
              <div className="mt-4 flex justify-between">
                <button className="btn-secondary" onClick={() => setStep(3)}>Back</button>
                <button className="btn-primary" disabled={expired} onClick={() => setStep(5)}>Continue to review</button>
              </div>
            </Card>
          )}

          {step === 5 && quote && beneficiary && (
            <Card title="Step 5 — Review and submit">
              <Rows
                items={[
                  ['You send', <Money key="s" value={quote.baseAmount} currency="AED" strong />],
                  ['Exchange rate', <span key="r" className="num">1 AED = {quote.customerRate} INR</span>],
                  ['Fee', <Money key="f" value={quote.feeAmount} currency="AED" />],
                  ['Total debited from wallet', <Money key="t" value={quote.totalDebitAmount} currency="AED" strong />],
                  ['Recipient receives', <Money key="i" value={quote.recipientAmount} currency="INR" strong />],
                  ['Beneficiary', <span key="b">{beneficiary.name} <span className="num text-xs text-ink-muted">({beneficiary.accountNumberMasked})</span></span>],
                  ['Estimated processing status', <span key="e" className="max-w-xs text-right" data-testid="estimated-status">{estimated}</span>],
                ]}
              />
              <div className="mt-3">
                <label className="label" htmlFor="purpose">Purpose / reference (optional)</label>
                <input id="purpose" className="input" maxLength={200} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Supplier invoice INV-1042" />
              </div>
              {(expired || quoteExpiredError) && <div className="mt-3">{requote}</div>}
              {!quoteExpiredError && <ErrorNote error={submit.error} />}
              <div className="mt-4 flex justify-between">
                <button className="btn-secondary" onClick={() => setStep(4)} disabled={submit.isPending}>Back</button>
                <button className="btn-primary" data-testid="submit-payment" disabled={expired || submit.isPending} onClick={() => submit.mutate()}>
                  {submit.isPending ? 'Submitting…' : `Submit payment of AED ${formatAmount(quote.totalDebitAmount)}`}
                </button>
              </div>
            </Card>
          )}

          {step === 6 && payment && (
            <Card title="Step 6 — Submitted">
              <Alert tone={payment.status === 'CANCELLED' ? 'bad' : 'good'} title={payment.status === 'CANCELLED' ? 'Payment was rejected by compliance' : 'Payment created'} testId="payment-created">
                Reference <span className="num font-semibold" data-testid="payment-reference">{payment.reference}</span> — current status <StatusBadge value={payment.status} label={payment.displayStatus} testId="created-status" />
              </Alert>
              <div className="mt-3">
                <Rows
                  items={[
                    ['Debited from wallet', payment.status === 'CANCELLED' ? 'Nothing' : <Money key="d" value={payment.totalDebitAmount} currency="AED" />],
                    ['Recipient receives', <Money key="r" value={payment.destinationAmount} currency="INR" />],
                    ['Compliance', <StatusBadge key="c" value={payment.complianceStatus} />],
                    ['Approval', <StatusBadge key="a" value={payment.approvalStatus} />],
                  ]}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/payments/${payment.id}`} className="btn-primary">View payment</Link>
                <button className="btn-secondary" onClick={() => { setStep(1); setQuote(null); setPreview(null); setPayment(null); setPurpose(''); submit.reset(); }}>Create another</button>
              </div>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <Card title="Wallet">
            {balance.data ? (
              <Rows items={[['Available', <span key="a" data-testid="wallet-available" data-value={balance.data.available}><Money value={balance.data.available} currency="AED" strong /></span>], ['Reserved', <Money key="r" value={balance.data.reserved} currency="AED" />]]} />
            ) : (
              <Loading />
            )}
          </Card>
          {beneficiary && step > 1 && step < 6 && (
            <Card title="Paying">
              <p className="font-medium">{beneficiary.name}</p>
              <p className="text-xs text-ink-muted">{beneficiary.bankName} · <span className="num">{beneficiary.accountNumberMasked}</span></p>
            </Card>
          )}
          {quote && step > 3 && step < 6 && <Card title="Locked quote">{quotePanel}</Card>}
        </aside>
      </div>
    </>
  );
}

export default function NewPaymentPage() {
  return (
    <>
      <PageHeader title="New payment" description="Six steps: beneficiary, amount, quote, compliance preview, review, submit." back={{ href: '/payments', label: 'Payments' }} />
      <Suspense>
        <Wizard />
      </Suspense>
    </>
  );
}
