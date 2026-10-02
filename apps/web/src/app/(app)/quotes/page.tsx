'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Card, Empty, Money, PageHeader, Pagination, QueryState, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { Quote } from '@/lib/types';

export default function QuotesPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['quotes', status, page], queryFn: () => api.page<Quote>(`/fx/quotes${qs({ status, page, pageSize: 20 })}`), refetchInterval: 10_000 });

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Every AED → INR quote issued. A quote is locked for 60 seconds, cannot be changed, and can fund exactly one payment."
        actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment</Link>}
      />
      <Card padded={false}>
        <div className="border-b border-surface-line p-3">
          <label className="label" htmlFor="q-status">Status</label>
          <select id="q-status" className="input !w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="USED">Used</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <QueryState query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="No quotes" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Mid rate</th>
                        <th className="text-right">Spread</th>
                        <th className="text-right">Your rate</th>
                        <th className="text-right">Fee</th>
                        <th className="text-right">Recipient gets</th>
                        <th>Status</th>
                        <th>Payment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((q) => (
                        <tr key={q.id}>
                          <td>
                            {formatDateTime(q.createdAt)}
                            <p className="text-xs text-ink-faint">{q.createdByName}</p>
                          </td>
                          <td className="text-right"><Money value={q.baseAmount} currency="AED" /></td>
                          <td className="num text-right">{q.midMarketRate}</td>
                          <td className="num text-right">{q.spreadPercentage}%</td>
                          <td className="num text-right">{q.customerRate}</td>
                          <td className="text-right"><Money value={q.feeAmount} currency="AED" /></td>
                          <td className="text-right"><Money value={q.recipientAmount} currency="INR" /></td>
                          <td>
                            <StatusBadge value={q.status} />
                            {q.status === 'ACTIVE' && <span className="num ml-1 text-xs text-ink-muted">{q.secondsRemaining}s</span>}
                          </td>
                          <td>{q.paymentId ? <Link className="link num" href={`/payments/${q.paymentId}`}>{q.paymentReference}</Link> : <span className="text-ink-faint">—</span>}</td>
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
