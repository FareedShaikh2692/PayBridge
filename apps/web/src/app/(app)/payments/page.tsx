'use client';

import { PAYMENT_STATUSES } from '@paybridge/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Send } from 'lucide-react';
import { Card, EmptyState, Money, PageHeader, Pagination, QueryState, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';
import type { Payment } from '@/lib/types';

function List() {
  const { can, me } = useAuth();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [awaiting, setAwaiting] = useState(sp.get('awaitingApproval') === 'true');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('createdAt:desc');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['payments', status, awaiting, from, to, sort, page],
    queryFn: () => api.page<Payment>(`/payments${qs({ status, awaitingApproval: awaiting ? 'true' : undefined, from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? `${to}T23:59:59.999Z` : undefined, sort, page, pageSize: 20 })}`),
    refetchInterval: 10_000,
  });
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <>
      <PageHeader title="Payments" description="Simulated AED → INR payment orders." actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment</Link>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-surface-line p-3">
          <div>
            <label className="label" htmlFor="p-status">Status</label>
            <select id="p-status" className="input" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
              <option value="">All</option>
              {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-from">From</label>
            <input id="p-from" type="date" className="input" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="p-to">To</label>
            <input id="p-to" type="date" className="input" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="p-sort">Sort</label>
            <select id="p-sort" className="input" value={sort} onChange={(e) => reset(() => setSort(e.target.value))}>
              <option value="createdAt:desc">Newest first</option>
              <option value="createdAt:asc">Oldest first</option>
              <option value="sourceAmount:desc">Largest amount</option>
              <option value="sourceAmount:asc">Smallest amount</option>
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" className="h-4 w-4" checked={awaiting} onChange={(e) => reset(() => setAwaiting(e.target.checked))} />
            Awaiting approval only
          </label>
        </div>
        <QueryState query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Send} title={status || awaiting || from || to ? 'No payments match these filters' : 'No payments yet'} action={can('payment.create') && <Link href="/payments/new" className="btn-primary">Create payment</Link>}>
                {status || awaiting || from || to ? 'Try clearing a filter.' : 'Once you create a simulated payment, your transaction history will appear here.'}
              </EmptyState>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table" data-testid="payments-table">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>Beneficiary</th>
                        <th className="text-right">You send</th>
                        <th className="text-right">Fee</th>
                        <th className="text-right">Recipient gets</th>
                        <th>Status</th>
                        <th>Created by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link href={`/payments/${p.id}`} className="link num">{p.reference}</Link>
                            <p className="text-xs text-ink-faint">{formatDateTime(p.createdAt)}</p>
                          </td>
                          <td>
                            {p.beneficiary?.name}
                            <p className="num text-xs text-ink-faint">{me?.isPlatformAdmin ? p.companyName : p.beneficiary?.accountNumberMasked}</p>
                          </td>
                          <td className="text-right"><Money value={p.sourceAmount} currency={p.sourceCurrency} /></td>
                          <td className="text-right"><Money value={p.feeAmount} currency={p.sourceCurrency} /></td>
                          <td className="text-right"><Money value={p.destinationAmount} currency={p.destinationCurrency} /></td>
                          <td><StatusBadge value={p.status} label={p.displayStatus} /></td>
                          <td className="text-ink-muted">{p.createdByName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination meta={data.meta} onPage={setPage} />
              </>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense>
      <List />
    </Suspense>
  );
}
