'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Card, Empty, ErrorNote, PageHeader, Pagination, QueryState, Stat, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { formatDateTime, shortId } from '@/lib/format';

interface WebhookEvent {
  id: string;
  eventId: string;
  eventType: string;
  providerPaymentId: string | null;
  paymentId: string | null;
  payload: unknown;
  status: string;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}
interface Jobs {
  driver: string;
  counts: Record<string, number>;
  deadLetters: { id: string; eventType: string; aggregateId: string; attempts: number; lastError: string | null; createdAt: string }[];
}

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const events = useQuery({ queryKey: ['webhooks', status, page], queryFn: () => api.page<WebhookEvent>(`/admin/webhook-events${qs({ status, page, pageSize: 20 })}`), refetchInterval: 10_000 });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api.get<Jobs>('/admin/jobs'), refetchInterval: 10_000 });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/admin/jobs/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }) });

  return (
    <>
      <PageHeader title="Webhooks & jobs" description="Provider events are stored once by event id and applied exactly once. Duplicates are acknowledged and ignored; stale or out-of-order events are recorded as ignored." />
      <QueryState query={jobs}>
        {(j) => (
          <div className="mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Queue driver" value={<span className="text-lg">{j.driver}</span>} sub="inline = outbox table; bullmq = Redis" />
              <Stat label="Jobs completed" value={j.counts.PUBLISHED ?? 0} />
              <Stat label="Jobs pending" value={(j.counts.PENDING ?? 0) + (j.counts.PROCESSING ?? 0)} />
              <Stat label="Dead-lettered" value={j.counts.FAILED ?? 0} sub="Exhausted five attempts" />
            </div>
            {j.deadLetters.length > 0 && (
              <Card title="Dead-letter queue" padded={false}>
                <ErrorNote error={retry.error} />
                <table className="table">
                  <thead><tr><th>Job</th><th>Subject</th><th>Attempts</th><th>Last error</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {j.deadLetters.map((d) => (
                      <tr key={d.id}>
                        <td className="num">{d.eventType}</td>
                        <td className="num">{shortId(d.aggregateId)}</td>
                        <td className="num">{d.attempts}</td>
                        <td className="text-xs text-bad">{d.lastError}</td>
                        <td className="text-right"><button className="btn-secondary" disabled={retry.isPending} onClick={() => retry.mutate(d.id)}>Re-drive</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        )}
      </QueryState>
      <Card title="Webhook events" padded={false} actions={
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-muted" htmlFor="w-status">Status</label>
          <select id="w-status" className="input !w-auto !py-1" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option><option value="RECEIVED">Received</option><option value="PROCESSED">Processed</option><option value="IGNORED">Ignored</option><option value="FAILED">Failed</option>
          </select>
        </div>
      }>
        <QueryState query={events}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="No webhook events" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table" data-testid="webhook-table">
                    <thead><tr><th>Received</th><th>Event</th><th>Payment</th><th>Status</th><th>Note</th><th><span className="sr-only">Payload</span></th></tr></thead>
                    <tbody>
                      {data.items.map((e) => (
                        <Fragment key={e.id}>
                          <tr>
                            <td className="whitespace-nowrap text-ink-muted">{formatDateTime(e.receivedAt)}</td>
                            <td><span className="num font-medium">{e.eventType}</span><p className="num text-xs text-ink-faint">{e.eventId}</p></td>
                            <td>{e.paymentId ? <Link className="link num" href={`/payments/${e.paymentId}`}>{shortId(e.paymentId)}</Link> : '—'}</td>
                            <td><StatusBadge value={e.status} /></td>
                            <td className="text-xs text-ink-muted">{e.error ?? '—'}</td>
                            <td className="text-right"><button className="btn-ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Payload'}</button></td>
                          </tr>
                          {open === e.id && (
                            <tr><td colSpan={6} className="!bg-surface-sunken"><pre className="num overflow-auto text-[11px] leading-relaxed">{JSON.stringify(e.payload, null, 2)}</pre></td></tr>
                          )}
                        </Fragment>
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
