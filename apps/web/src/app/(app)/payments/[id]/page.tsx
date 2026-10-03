'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState } from 'react';
import { LedgerTransactionCard } from '@/components/ledger';
import { ArrowRight, Undo2 } from 'lucide-react';
import { Checklist, LedgerTotals, Lifecycle, addAmounts, type CheckItem, type LifecycleStep } from '@/components/payment-visuals';
import { Alert, Button, Card, CopyButton, Empty, ErrorNote, Field, Modal, Money, PageHeader, QueryState, Rows, StatusBadge, Timeline, statusTone, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';
import type { PaymentDetail } from '@/lib/types';

const TERMINAL = ['PAID', 'FAILED', 'CANCELLED', 'RETURNED'];
type Action = 'approve' | 'reject' | 'cancel';
const ACTION_COPY: Record<Action, { title: string; button: string; reasonRequired: boolean; danger: boolean; help: string }> = {
  approve: { title: 'Approve payment', button: 'Approve', reasonRequired: false, danger: false, help: 'Once approved and clear of compliance, the payment is captured and sent to the mock provider.' },
  reject: { title: 'Reject payment', button: 'Reject payment', reasonRequired: true, danger: true, help: 'The payment is cancelled and the reserved funds return to the wallet.' },
  cancel: { title: 'Cancel payment', button: 'Cancel payment', reasonRequired: false, danger: true, help: 'The payment is cancelled and the reserved funds return to the wallet. This cannot be undone.' },
};

/** Rule inputs as readable "label value" pairs rather than raw JSON. */
function DetailList({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value).filter(([k]) => k !== 'rescreen');
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {value.rescreen ? <span className="font-medium text-info">Re-screen</span> : null}
      {entries.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
          {titleCase(k.replace(/([a-z])([A-Z])/g, '$1_$2'))}: <span className="num font-medium text-foreground">{typeof v === 'object' && v !== null ? (Array.isArray(v) ? v.join(', ') : Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')) : String(v)}</span>
        </span>
      ))}
    </span>
  );
}

const STEPS = ['Created', 'Compliance', 'Approved', 'Processing', 'Paid', 'Reconciled'] as const;

/** Maps the payment's state machine onto the six stages a person follows. */
function lifecycle(p: PaymentDetail): LifecycleStep[] {
  const at = (status: string) => p.timeline.find((h) => h.toStatus === status)?.createdAt;
  const reached: Record<string, number> = { CREATED: 1, COMPLIANCE_REVIEW: 1, APPROVED: 3, PROCESSING: 4, PAID: 5, FAILED: 4, RETURNED: 5 };
  let done = reached[p.status] ?? 1;
  const cleared = p.complianceStatus === 'CLEAR' || p.complianceStatus === 'CLEARED_BY_ADMIN';
  if (p.status === 'CREATED' && cleared) done = 2;
  if (p.status === 'CANCELLED') done = p.timeline.some((h) => h.toStatus === 'APPROVED') ? 3 : cleared ? 2 : 1;
  const matched = p.reconciliation?.status === 'MATCHED';
  if (p.status === 'PAID' && matched) done = 6;
  const errorAt = p.status === 'CANCELLED' ? done : p.status === 'FAILED' ? 4 : p.status === 'RETURNED' ? 5 : -1;
  const subs: (string | undefined)[] = [
    formatDateTime(p.createdAt),
    p.complianceStatus === 'REVIEW' ? 'In review' : p.complianceStatus.startsWith('REJECT') ? 'Rejected' : p.complianceStatus === 'CLEARED_BY_ADMIN' ? 'Cleared by admin' : p.complianceStatus === 'CLEAR' ? 'Clear' : undefined,
    at('APPROVED') ? formatDateTime(at('APPROVED')) : p.approvalStatus === 'PENDING' ? 'Awaiting approver' : undefined,
    at('PROCESSING') ? formatDateTime(at('PROCESSING')) : undefined,
    p.status === 'FAILED' ? 'Payout failed' : at('PAID') ? formatDateTime(at('PAID')) : undefined,
    p.status === 'RETURNED' ? 'Returned' : p.reconciliation ? titleCase(p.reconciliation.status) : p.status === 'PAID' ? 'Next run' : undefined,
  ];
  if (p.status === 'CANCELLED') subs[errorAt] = 'Cancelled';
  return STEPS.map((label, i) => ({
    label,
    sub: subs[i],
    state: i === errorAt ? 'error' : i < done ? 'done' : i === done && errorAt < 0 && p.status !== 'CANCELLED' ? 'current' : 'todo',
  }));
}

function complianceItems(p: PaymentDetail): CheckItem[] {
  const rules = p.complianceChecks.filter((c) => c.ruleCode !== 'MANUAL_DECISION');
  const manual = p.complianceChecks.filter((c) => c.ruleCode === 'MANUAL_DECISION');
  return [
    { label: 'KYB approved', detail: 'Payments can only be created by companies with approved KYB', state: 'pass' },
    { label: 'Beneficiary verified', detail: p.beneficiary ? `${p.beneficiary.name} · ${p.beneficiary.ifsc}` : undefined, state: 'pass' },
    { label: 'Currency supported', detail: `${p.sourceCurrency} → ${p.destinationCurrency}`, state: 'pass' },
    ...rules.map((c): CheckItem => ({
      label: c.ruleName,
      detail: c.details ? <DetailList value={c.details} /> : c.triggered ? `Triggered — ${c.outcome.toLowerCase()}` : undefined,
      state: !c.triggered ? 'pass' : c.outcome === 'REJECT' ? 'fail' : 'warn',
    })),
    ...manual.map((c): CheckItem => ({ label: `Manual decision by ${c.decidedByName}`, detail: `“${c.decisionNote}”`, state: c.outcome === 'CLEAR' ? 'pass' : 'fail' })),
  ];
}

export default function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const toast = useToast();
  const query = useQuery({
    queryKey: ['payment', id],
    queryFn: () => api.get<PaymentDetail>(`/payments/${id}`),
    // Follow the payment while it is still moving.
    refetchInterval: (q) => (q.state.data && (!TERMINAL.includes(q.state.data.status) || (awaitingReturn && q.state.data.status === 'PAID')) ? 2_000 : false),
  });
  const act = useMutation({
    mutationFn: () => api.post<PaymentDetail>(`/payments/${id}/${action}`, reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: (p) => {
      qc.setQueryData(['payment', id], p);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setAction(null);
      setReason('');
      toast(action === 'approve' ? 'Payment approved.' : action === 'reject' ? 'Payment rejected.' : 'Payment cancelled.');
    },
  });
  // Sandbox control: ask the mock provider to return a paid payout. The refund then arrives by webhook.
  const simulateReturn = useMutation({
    mutationFn: () => api.post(`/sandbox/provider/payments/${id}/return`, {}),
    onSuccess: () => {
      setAwaitingReturn(true);
      toast('Return requested. The provider will confirm by webhook.', 'info');
      qc.invalidateQueries({ queryKey: ['payment', id] });
    },
  });
  const open = (a: Action) => { act.reset(); setReason(''); setAction(a); };

  return (
    <QueryState query={query}>
      {(p) => {
        const awaitingGates = ['CREATED', 'COMPLIANCE_REVIEW'].includes(p.status);
        const isCreator = p.createdById === me?.user.id;
        const canApprove = can('payment.approve') && awaitingGates && p.approvalStatus === 'PENDING';
        const canCancel = can('payment.cancel') && ['CREATED', 'COMPLIANCE_REVIEW', 'APPROVED'].includes(p.status) && (me?.role !== 'MAKER' || isCreator);
        const copy = action ? ACTION_COPY[action] : null;
        return (
          <>
            <PageHeader
              title={`Payment to ${p.beneficiary?.name ?? 'beneficiary'}`}
              description={p.purpose ?? undefined}
              back={{ href: '/payments', label: 'Payments' }}
              actions={
                <>
                  {canApprove && !isCreator && (
                    <>
                      <button className="btn-primary" onClick={() => open('approve')} data-testid="approve-button">Approve</button>
                      <button className="btn-secondary" onClick={() => open('reject')}>Reject</button>
                    </>
                  )}
                  {canCancel && <button className="btn-secondary" onClick={() => open('cancel')}>Cancel payment</button>}
                  {me?.isPlatformAdmin && p.complianceStatus === 'REVIEW' && <Link href="/admin/compliance" className="btn-primary">Open compliance queue</Link>}
                  {me?.isPlatformAdmin && p.status === 'PAID' && (
                    <Button variant="secondary" icon={Undo2} loading={simulateReturn.isPending || awaitingReturn} loadingLabel="Returning…" onClick={() => simulateReturn.mutate()} data-testid="simulate-return">
                      Simulate provider return
                    </Button>
                  )}
                </>
              }
            />

            <section className="card mb-6 overflow-hidden" data-testid="payment-summary">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payment ID</p>
                  <p className="mt-1 flex items-center gap-1 text-lg font-semibold"><span className="num">{p.reference}</span><CopyButton value={p.reference} label="Copy payment ID" /></p>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                  <span className="flex items-center gap-2"><span className="text-muted-foreground">Status</span><StatusBadge value={p.status} label={p.displayStatus} testId="payment-status" /></span>
                  <span className="flex items-center gap-2"><span className="text-muted-foreground">Compliance</span><StatusBadge value={p.complianceStatus} testId="compliance-status" /></span>
                  <span className="flex items-center gap-2"><span className="text-muted-foreground">Approval</span><StatusBadge value={p.approvalStatus} testId="approval-status" /></span>
                </div>
              </div>
              <div className="grid gap-5 px-5 py-5 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <p className="text-xs text-muted-foreground">You send</p>
                  <p className="mt-1 text-2xl"><Money value={p.sourceAmount} currency={p.sourceCurrency} strong /></p>
                </div>
                <span aria-hidden="true" className="hidden h-9 w-9 place-items-center rounded-full border border-border bg-background text-muted-foreground sm:grid"><ArrowRight className="h-4 w-4" /></span>
                <div className="sm:text-right">
                  <p className="text-xs text-muted-foreground">Recipient receives</p>
                  <p className="mt-1 text-2xl" data-testid="recipient-amount"><Money value={p.destinationAmount} currency={p.destinationCurrency} strong /></p>
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
                {([
                  ['FX rate', <span key="r" className="num">{p.exchangeRate}</span>],
                  ['Fee', <Money key="f" value={p.feeAmount} currency="AED" />],
                  ['Total debited', <Money key="t" value={p.totalDebitAmount} currency="AED" strong />],
                  ['Provider', <span key="p" className="num text-xs">{p.providerPaymentId ?? (TERMINAL.includes(p.status) ? '—' : 'Pending')}</span>],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} className="bg-card px-5 py-3"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm">{v}</dd></div>
                ))}
              </dl>
            </section>

            <Card title="Lifecycle" className="mb-6" actions={!TERMINAL.includes(p.status) ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />Updating automatically</span> : undefined}>
              <Lifecycle steps={lifecycle(p)} testId="payment-lifecycle" />
            </Card>

            {canApprove && isCreator && <div className="mb-4"><Alert tone="info" title="Waiting for a second person">You created this payment, so someone else must approve it.</Alert></div>}
            <ErrorNote error={simulateReturn.error} />
            {p.status === 'RETURNED' && <div className="mb-4"><Alert tone="warn" title="The payout was returned by the provider">Reason: <span className="num">{p.failureReason}</span>. The capture was reversed by new ledger postings and AED {p.totalDebitAmount} returned to the wallet, fee included.</Alert></div>}
            {p.status === 'FAILED' && <div className="mb-4"><Alert tone="bad" title="The payout failed">Provider reason: <span className="num">{p.failureReason}</span>. The capture was reversed and AED {p.totalDebitAmount} returned to the wallet, fee included.</Alert></div>}
            {p.status === 'CANCELLED' && <div className="mb-4"><Alert tone="neutral" title={`Cancelled — ${titleCase(p.cancellationReason ?? 'cancelled')}`}>Any reserved funds were released back to the wallet.</Alert></div>}

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card title="Ledger" actions={<span className="text-xs text-ink-muted">Double entry: debits equal credits in every currency</span>}>
                  {p.ledgerTransactions.length === 0 ? (
                    <Empty title={can('ledger.read') ? 'No ledger postings' : 'Ledger postings are visible to administrators, approvers and viewers'} />
                  ) : (
                    <>
                      <LedgerTotals
                        testId="ledger-totals"
                        totals={Array.from(new Set(p.ledgerTransactions.flatMap((t) => Object.keys(t.totals)))).map((currency) => ({
                          currency,
                          debit: addAmounts(p.ledgerTransactions.map((t) => t.totals[currency]?.debit ?? '0.00')),
                          credit: addAmounts(p.ledgerTransactions.map((t) => t.totals[currency]?.credit ?? '0.00')),
                        }))}
                      />
                      <details className="group mt-4">
                        <summary className="cursor-pointer select-none text-[13px] font-medium text-primary hover:underline">Show {p.ledgerTransactions.length} posting{p.ledgerTransactions.length === 1 ? '' : 's'}</summary>
                        <div className="mt-3 space-y-3">{p.ledgerTransactions.map((t) => <LedgerTransactionCard key={t.id} tx={t} showPayment={false} />)}</div>
                      </details>
                    </>
                  )}
                </Card>

                <Card title="Compliance checks">
                  {p.complianceChecks.length === 0 ? (
                    <Empty title="Compliance details are not available for your role" />
                  ) : (
                    <Checklist
                      testId="compliance-checklist"
                      items={complianceItems(p)}
                      result={
                        p.complianceStatus === 'CLEAR'
                          ? { tone: 'pass', title: 'Approved', message: 'All configured sandbox rules passed.' }
                          : p.complianceStatus === 'CLEARED_BY_ADMIN'
                            ? { tone: 'pass', title: 'Approved after review', message: 'A rule flagged this payment and a platform admin cleared it.' }
                          : p.complianceStatus === 'REVIEW'
                            ? { tone: 'warn', title: 'In review', message: 'A platform admin must clear or reject this payment.' }
                            : { tone: 'fail', title: 'Blocked', message: 'A sandbox rule rejected this payment. No funds were moved.' }
                      }
                    />
                  )}
                </Card>
              </div>

              <div className="space-y-6">
                <Card title="Timeline">
                  <Timeline
                    items={p.timeline.map((h) => ({
                      id: h.id,
                      title: titleCase(h.toStatus),
                      detail: <>{h.reason && <span>{h.reason} · </span>}<span className="text-xs">{h.actorType === 'USER' ? 'by a user' : h.actorType === 'PROVIDER' ? 'by provider webhook' : 'by the system'}</span></>,
                      at: h.createdAt,
                      tone: statusTone(h.toStatus),
                    }))}
                  />
                </Card>
                <Card title="Beneficiary">
                  <Rows
                    items={[
                      ['Name', <Link key="n" className="link" href={`/beneficiaries/${p.beneficiaryId}`}>{p.beneficiary?.name}</Link>],
                      ['Bank', p.beneficiary?.bankName],
                      ['Account', <span key="a" className="num">{p.beneficiary?.accountNumberMasked}</span>],
                      ['IFSC', <span key="i" className="num">{p.beneficiary?.ifsc}</span>],
                    ]}
                  />
                </Card>
                <Card title="Approval">
                  {!p.approval ? (
                    <p className="text-ink-muted">Maker-checker was not required for this payment.</p>
                  ) : (
                    <>
                      <Rows items={[['Requested by', p.approval.requestedByName], ['Request status', <StatusBadge key="s" value={p.approval.status} />]]} />
                      {p.approval.actions.map((a) => (
                        <p key={a.id} className="mt-2 rounded-md bg-surface-sunken p-2 text-xs">
                          <span className="font-semibold">{a.actorName}</span> {a.action === 'APPROVE' ? 'approved' : 'rejected'} · {formatDateTime(a.createdAt)}
                          {a.reason && <span className="block text-ink-muted">“{a.reason}”</span>}
                        </p>
                      ))}
                    </>
                  )}
                </Card>
                <Card title="Record">
                  <Rows
                    items={[
                      ['Created by', p.createdByName],
                      ['Created', formatDateTime(p.createdAt)],
                      ['Completed', formatDateTime(p.completedAt)],
                      ['Provider payment', <span key="p" className="num text-xs">{p.providerPaymentId ?? '—'}</span>],
                      ...(me?.isPlatformAdmin ? ([['Company', p.companyName]] as [string, React.ReactNode][]) : []),
                    ]}
                  />
                  {can('audit.read') && <Link className="link mt-2 inline-block text-xs" href={`/admin/audit-logs?entityId=${p.id}`}>View audit trail</Link>}
                </Card>
              </div>
            </div>

            <Modal open={Boolean(action)} title={copy?.title ?? ''} onClose={() => setAction(null)}>
              {copy && (
                <form onSubmit={(e) => { e.preventDefault(); act.mutate(); }} className="space-y-4">
                  <p>{copy.help}</p>
                  <Rows items={[['Payment', <span key="r" className="num">{p.reference}</span>], ['Total debit', <Money key="t" value={p.totalDebitAmount} currency="AED" strong />], ['Beneficiary', p.beneficiary?.name]]} />
                  <Field label={copy.reasonRequired ? 'Reason (required)' : 'Note (optional)'} htmlFor="reason">
                    <textarea id="reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required={copy.reasonRequired} minLength={copy.reasonRequired ? 3 : undefined} />
                  </Field>
                  <ErrorNote error={act.error} />
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary" onClick={() => setAction(null)}>Keep as is</button>
                    <button type="submit" data-testid="confirm-action" className={copy.danger ? 'btn-danger' : 'btn-primary'} disabled={act.isPending || (copy.reasonRequired && reason.trim().length < 3)}>
                      {act.isPending ? 'Working…' : copy.button}
                    </button>
                  </div>
                </form>
              )}
            </Modal>
          </>
        );
      }}
    </QueryState>
  );
}
