'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useState } from 'react';
import { Card, Empty, PageHeader, Pagination, QueryState } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { formatDateTime, shortId, titleCase } from '@/lib/format';

interface AuditLog {
  id: string;
  userId: string | null;
  companyId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  user: { fullName: string; email: string } | null;
}
const ENTITIES = ['payment', 'fx_quote', 'beneficiary', 'company', 'kyb_profile', 'ledger_transaction', 'user', 'webhook_event', 'compliance_rule', 'reconciliation_run'];

function AuditTrail() {
  const sp = useSearchParams();
  const [entityId, setEntityId] = useState(sp.get('entityId') ?? '');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['audit', entityId, entityType, action, page], queryFn: () => api.page<AuditLog>(`/audit-logs${qs({ entityId, entityType, action: action.toUpperCase(), page, pageSize: 25 })}`) });
  const reset = (fn: () => void) => { fn(); setPage(1); };

  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when. Records are written in the same transaction as the change they describe and can never be edited or deleted." />
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-surface-line p-3">
          <div>
            <label className="label" htmlFor="a-type">Entity</label>
            <select id="a-type" className="input" value={entityType} onChange={(e) => reset(() => setEntityType(e.target.value))}>
              <option value="">All</option>
              {ENTITIES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="a-action">Action</label>
            <input id="a-action" className="input num" value={action} onChange={(e) => reset(() => setAction(e.target.value.trim()))} placeholder="e.g. PAYMENT_PAID" />
          </div>
          <div className="min-w-64 flex-1">
            <label className="label" htmlFor="a-entity">Entity ID</label>
            <input id="a-entity" className="input num" value={entityId} onChange={(e) => reset(() => setEntityId(e.target.value.trim()))} placeholder="e.g. a payment ID" />
          </div>
        </div>
        <QueryState query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="No audit records match these filters" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table" data-testid="audit-table">
                    <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th><th>Request</th><th><span className="sr-only">Detail</span></th></tr></thead>
                    <tbody>
                      {data.items.map((a) => (
                        <Fragment key={a.id}>
                          <tr>
                            <td className="whitespace-nowrap text-ink-muted">{formatDateTime(a.createdAt)}</td>
                            <td className="num font-medium">{a.action}</td>
                            <td>{titleCase(a.entityType)}<p className="num text-xs text-ink-faint">{shortId(a.entityId)}</p></td>
                            <td>{a.user ? <>{a.user.fullName}<p className="text-xs text-ink-faint">{a.user.email}</p></> : <span className="text-ink-muted">System</span>}</td>
                            <td className="num text-xs text-ink-faint">{a.requestId ? `${a.requestId.slice(0, 16)}…` : '—'}{a.ipAddress && <p>{a.ipAddress}</p>}</td>
                            <td className="text-right"><button className="btn-ghost" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Hide' : 'Detail'}</button></td>
                          </tr>
                          {open === a.id && (
                            <tr>
                              <td colSpan={6} className="!bg-surface-sunken">
                                <div className="grid gap-3 md:grid-cols-2">
                                  {[['Before', a.oldValue], ['After', a.newValue]].map(([label, value]) => (
                                    <div key={label as string}>
                                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label as string}</p>
                                      <pre className="num overflow-auto rounded-md border border-surface-line bg-surface p-2 text-[11px] leading-relaxed">{value ? JSON.stringify(value, null, 2) : '—'}</pre>
                                    </div>
                                  ))}
                                </div>
                                <p className="num mt-2 text-[11px] text-ink-faint">entity {a.entityId ?? '—'} · request {a.requestId ?? '—'} · {a.userAgent ?? 'no user agent'}</p>
                              </td>
                            </tr>
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

export default function AuditLogsPage() {
  return (
    <Suspense>
      <AuditTrail />
    </Suspense>
  );
}
