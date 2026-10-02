'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { Alert, Card, Empty, ErrorNote, Money, PageHeader, QueryState, Rows, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { Beneficiary, Payment } from '@/lib/types';

export default function BeneficiaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['beneficiaries', id], queryFn: () => api.get<Beneficiary>(`/beneficiaries/${id}`) });
  const payments = useQuery({ queryKey: ['payments', 'beneficiary', id], queryFn: () => api.page<Payment>(`/payments${qs({ beneficiaryId: id, pageSize: 10 })}`) });
  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/beneficiaries/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['beneficiaries'] }),
  });

  return (
    <QueryState query={query}>
      {(b) => (
        <>
          <PageHeader
            title={b.name}
            back={{ href: '/beneficiaries', label: 'Beneficiaries' }}
            actions={
              <>
                {b.status === 'ACTIVE' && can('payment.create') && <Link href={`/payments/new?beneficiaryId=${b.id}`} className="btn-primary">Pay this beneficiary</Link>}
                {b.status !== 'BLOCKED' && can('beneficiary.update') && (
                  <button className="btn-secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate(b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}>
                    {b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </>
            }
          />
          <ErrorNote error={setStatus.error} />
          {b.status === 'BLOCKED' && <div className="mb-4"><Alert tone="bad" title="Blocked by screening">The mock sanctions screening matched this name. A blocked beneficiary cannot be paid or reactivated.</Alert></div>}
          {b.screeningResult === 'PEP_MATCH' && <div className="mb-4"><Alert tone="warn" title="PEP match (simulated)">Every payment to this beneficiary goes to compliance review.</Alert></div>}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card title="Details">
              <Rows
                items={[
                  ['Status', <StatusBadge key="s" value={b.status} />],
                  ['Screening', <StatusBadge key="c" value={b.screeningResult} />],
                  ['Country', b.country],
                  ['Bank', b.bankName],
                  ['Account number', <span key="a" className="num" data-testid="masked-account">{b.accountNumberMasked}</span>],
                  ['IFSC', <span key="i" className="num">{b.ifsc}</span>],
                  ['Account holder', b.accountHolderName],
                  ['Added', formatDateTime(b.createdAt)],
                ]}
              />
            </Card>
            <Card title="Payments to this beneficiary" className="lg:col-span-2" padded={false}>
              <QueryState query={payments}>
                {(p) =>
                  p.items.length === 0 ? (
                    <Empty title="No payments yet" />
                  ) : (
                    <table className="table">
                      <thead>
                        <tr><th>Reference</th><th className="text-right">Sent</th><th className="text-right">Received</th><th>Status</th><th>Created</th></tr>
                      </thead>
                      <tbody>
                        {p.items.map((x) => (
                          <tr key={x.id}>
                            <td><Link className="link num" href={`/payments/${x.id}`}>{x.reference}</Link></td>
                            <td className="text-right"><Money value={x.sourceAmount} currency="AED" /></td>
                            <td className="text-right"><Money value={x.destinationAmount} currency="INR" /></td>
                            <td><StatusBadge value={x.status} label={x.displayStatus} /></td>
                            <td className="text-ink-muted">{formatDateTime(x.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                }
              </QueryState>
            </Card>
          </div>
        </>
      )}
    </QueryState>
  );
}
