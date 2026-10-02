'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Alert, Badge, Card, Empty, ErrorNote, PageHeader, Pagination, QueryState, Stat, StatusBadge } from '@/components/ui';
import { api, qs, type PageMeta } from '@/lib/api';
import { formatDateTime, titleCase } from '@/lib/format';

interface Run {
  id: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  totalItems: number;
  matchedCount: number;
  issueCount: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  scheduled: boolean;
}
interface Item {
  id: string;
  status: string;
  reasonCodes: string[];
  paymentId: string | null;
  paymentReference: string | null;
  companyName: string | null;
  providerPaymentId: string | null;
  currency: string | null;
  internal: any;
  provider: any;
  ledger: any;
}
interface Report {
  run: Run | null;
  summary: Record<string, number>;
  items: Item[];
  meta: PageMeta;
}
const STATUSES = ['MATCHED', 'MISMATCH', 'MISSING', 'DUPLICATE', 'REVIEW_REQUIRED'];

export default function ReconciliationPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [date, setDate] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const validPayment = /^[0-9a-f-]{36}$/i.test(paymentId) ? paymentId : undefined;
  const report = useQuery({
    queryKey: ['reconciliation', status, currency, validPayment, date, page],
    queryFn: () => api.get<Report>(`/reports/reconciliation${qs({ status, currency, paymentId: validPayment, date, page, pageSize: 20 })}`),
    refetchInterval: (q) => (q.state.data?.run?.status === 'RUNNING' ? 2_000 : false),
  });
  const run = useMutation({
    mutationFn: () => api.post<Run>('/reports/reconciliation/run', {}),
    onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: ['reconciliation'] }), 1500),
  });
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Compares three independent records of every payment — the internal payment, the provider's record and the ledger — and reports where they disagree. It never changes anything."
        actions={<button className="btn-primary" onClick={() => run.mutate()} disabled={run.isPending} data-testid="run-reconciliation">{run.isPending ? 'Starting…' : 'Run reconciliation'}</button>}
      />
      <ErrorNote error={run.error} />
      {run.isSuccess && <div className="mb-4"><Alert tone="info">A run was queued. The report below refreshes when it completes.</Alert></div>}
      <QueryState query={report}>
        {(r) =>
          !r.run ? (
            <Card><Empty title="No completed run for this selection">Run reconciliation to produce a report.</Empty></Card>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="recon-summary">
                {STATUSES.map((s) => <Stat key={s} label={titleCase(s)} value={r.summary[s] ?? 0} testId={`recon-${s}`} />)}
              </div>
              <p className="text-xs text-ink-muted">
                Run {r.run.scheduled ? '(scheduled)' : '(manual)'} started {formatDateTime(r.run.startedAt)} · period {formatDateTime(r.run.periodFrom)} – {formatDateTime(r.run.periodTo)} · {r.run.totalItems} items, {r.run.issueCount} needing attention
              </p>
              <Card padded={false} title="Items">
                <div className="flex flex-wrap items-end gap-3 border-b border-surface-line p-3">
                  <div>
                    <label className="label" htmlFor="r-status">Status</label>
                    <select id="r-status" className="input" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
                      <option value="">All</option>
                      {STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="r-ccy">Currency</label>
                    <select id="r-ccy" className="input" value={currency} onChange={(e) => reset(() => setCurrency(e.target.value))}>
                      <option value="">All</option><option value="AED">AED</option><option value="INR">INR</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="r-date">Run date</label>
                    <input id="r-date" type="date" className="input" value={date} onChange={(e) => reset(() => setDate(e.target.value))} />
                  </div>
                  <div className="min-w-64 flex-1">
                    <label className="label" htmlFor="r-payment">Payment ID</label>
                    <input id="r-payment" className="input num" value={paymentId} onChange={(e) => reset(() => setPaymentId(e.target.value.trim()))} placeholder="Full payment UUID" />
                  </div>
                </div>
                {r.items.length === 0 ? (
                  <Empty title="No items match these filters" />
                ) : (
                  <div className="table-wrap">
                    <table className="table" data-testid="recon-table">
                      <thead><tr><th>Result</th><th>Payment</th><th>Company</th><th>Findings</th><th>Internal</th><th>Provider</th><th><span className="sr-only">Detail</span></th></tr></thead>
                      <tbody>
                        {r.items.map((i) => (
                          <Fragment key={i.id}>
                            <tr>
                              <td><StatusBadge value={i.status} /></td>
                              <td>{i.paymentId ? <Link className="link num" href={`/payments/${i.paymentId}`}>{i.paymentReference}</Link> : <span className="text-ink-faint">Ledger-wide / none</span>}</td>
                              <td>{i.companyName ?? '—'}</td>
                              <td>{i.reasonCodes.length ? <div className="flex flex-wrap gap-1">{i.reasonCodes.map((c) => <Badge key={c} tone="bad">{titleCase(c)}</Badge>)}</div> : <span className="text-ink-faint">None</span>}</td>
                              <td><StatusBadge value={i.internal?.status} /></td>
                              <td>{i.provider?.records?.length ? i.provider.records.map((p: any) => <StatusBadge key={p.providerPaymentId} value={p.status} />) : <span className="text-ink-faint">No record</span>}</td>
                              <td className="text-right"><button className="btn-ghost" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Hide' : 'Compare'}</button></td>
                            </tr>
                            {open === i.id && (
                              <tr>
                                <td colSpan={7} className="!bg-surface-sunken">
                                  <div className="grid gap-3 md:grid-cols-3">
                                    {[['Internal payment', i.internal], ['Provider record', i.provider], ['Ledger', i.ledger]].map(([label, value]) => (
                                      <div key={label as string}>
                                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label as string}</p>
                                        <pre className="num max-h-64 overflow-auto rounded-md border border-surface-line bg-surface p-2 text-[11px] leading-relaxed">{value ? JSON.stringify(value, null, 2) : '—'}</pre>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <Pagination meta={r.meta} onPage={setPage} />
              </Card>
            </div>
          )
        }
      </QueryState>
    </>
  );
}
