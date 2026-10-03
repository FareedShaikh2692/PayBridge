'use client';

import { PAYMENT_STATUSES } from '@paybridge/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Send } from 'lucide-react';
import { Card, CopyButton, EmptyState, Money, PageHeader, Pagination, QueryState, StatusBadge } from '@/components/ui';
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
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const query = useQuery({
    queryKey: ['payments', q, status, awaiting, from, to, sort, page],
    queryFn: () => api.page<Payment>(`/payments${qs({ q: q || undefined, status, awaitingApproval: awaiting ? 'true' : undefined, from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? `${to}T23:59:59.999Z` : undefined, sort, page, pageSize: 20 })}`),
    refetchInterval: 10_000,
  });
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const filtered = Boolean(q || status || awaiting || from || to);
  const sortHeader = (field: string, label: string, align = '') => {
    const [f, dir] = sort.split(':');
    const active = f === field;
    const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={align} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={`inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${active ? 'text-foreground' : ''}`} onClick={() => reset(() => setSort(`${field}:${active && dir === 'desc' ? 'asc' : 'desc'}`))}>
          {label}<Icon aria-hidden="true" className="h-3 w-3" />
        </button>
      </th>
    );
  };

  return (
    <>
      <PageHeader title="Payments" description="Simulated AED → INR payment orders." actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment</Link>} />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-surface-line p-3">
          <div className="w-full sm:w-64">
            <label className="label" htmlFor="p-search">Search</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input id="p-search" type="search" className="input w-full pl-9" placeholder="Payment ID or beneficiary" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
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
              <EmptyState icon={Send} title={filtered ? 'No payments match these filters' : 'No payments yet'} action={can('payment.create') && <Link href="/payments/new" className="btn-primary">Create payment</Link>}>
                {filtered ? 'Try clearing the search or a filter.' : 'Once you create a simulated payment, your transaction history will appear here.'}
              </EmptyState>
            ) : (
              <>
                <div className="table-wrap max-h-[65vh] overflow-y-auto">
                  <table className="table table-sticky" data-testid="payments-table">
                    <thead>
                      <tr>
                        <th>Payment ID</th>
                        <th>Beneficiary</th>
                        {sortHeader('sourceAmount', 'You send', 'text-right')}
                        <th className="text-right">Fee</th>
                        <th className="text-right">Recipient gets</th>
                        <th>Status</th>
                        {sortHeader('createdAt', 'Created')}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <span className="flex items-center gap-1"><Link href={`/payments/${p.id}`} className="link num">{p.reference}</Link><CopyButton value={p.reference} label="Copy payment ID" /></span>
                          </td>
                          <td>
                            {p.beneficiary?.name}
                            <p className="num text-xs text-ink-faint">{me?.isPlatformAdmin ? p.companyName : p.beneficiary?.accountNumberMasked}</p>
                          </td>
                          <td className="text-right"><Money value={p.sourceAmount} currency={p.sourceCurrency} /></td>
                          <td className="text-right"><Money value={p.feeAmount} currency={p.sourceCurrency} /></td>
                          <td className="text-right"><Money value={p.destinationAmount} currency={p.destinationCurrency} /></td>
                          <td><StatusBadge value={p.status} label={p.displayStatus} /></td>
                          <td className="whitespace-nowrap"><span className="num">{formatDateTime(p.createdAt)}</span><p className="text-xs text-ink-faint">by {p.createdByName}</p></td>
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
