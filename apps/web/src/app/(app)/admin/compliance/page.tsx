'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, Money, PageHeader, QueryState, Rows, StatusBadge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface QueueItem {
  paymentId: string;
  reference: string;
  companyName: string;
  beneficiaryName: string;
  destinationCountry: string;
  sourceAmount: string;
  sourceCurrency: string;
  approvalStatus: string;
  createdAt: string;
  rulesFired: { ruleCode: string; ruleName: string; outcome: string; details: unknown }[];
}
interface Rule {
  id: string;
  code: string;
  name: string;
  description: string | null;
  parameters: Record<string, unknown>;
  outcome: string;
  enabled: boolean;
  version: number;
}

export default function CompliancePage() {
  const qc = useQueryClient();
  const [item, setItem] = useState<QueueItem | null>(null);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const queue = useQuery({ queryKey: ['compliance-queue'], queryFn: () => api.page<QueueItem>('/admin/compliance-queue?pageSize=50'), refetchInterval: 10_000 });
  const rules = useQuery({ queryKey: ['compliance-rules'], queryFn: () => api.get<Rule[]>('/admin/compliance/rules') });
  const decide = useMutation({
    mutationFn: (decision: 'CLEAR' | 'REJECT') => api.post(`/admin/compliance/${item!.paymentId}/decision`, { decision, reason: reason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries();
      setItem(null);
    },
  });
  const rescreen = useMutation({
    mutationFn: (paymentId: string) => api.post(`/admin/compliance/${paymentId}/rescreen`, {}),
    onSuccess: () => {
      toast('Re-screen queued. The rules will be evaluated again.', 'info');
      setTimeout(() => qc.invalidateQueries({ queryKey: ['compliance-queue'] }), 2500);
    },
  });
  const toggle = useMutation({
    mutationFn: (r: Rule) => api.patch(`/admin/compliance/rules/${r.id}`, { enabled: !r.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['compliance-rules'] }),
  });

  return (
    <>
      <PageHeader title="Compliance queue" description="Payments held by a rule. A decision needs a reason, is recorded, and is final. Screening here is simulated and uses no real watch-list." />
      <Card title="Awaiting decision" padded={false}>
        <QueryState query={queue}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="The queue is empty">No payments are waiting for a compliance decision.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table" data-testid="compliance-queue">
                  <thead><tr><th>Payment</th><th>Company</th><th>Beneficiary</th><th className="text-right">Amount</th><th>Rules fired</th><th>Approval</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {data.items.map((q) => (
                      <tr key={q.paymentId}>
                        <td><Link className="link num" href={`/payments/${q.paymentId}`}>{q.reference}</Link><p className="text-xs text-ink-faint">{formatDateTime(q.createdAt)}</p></td>
                        <td>{q.companyName}</td>
                        <td>{q.beneficiaryName} <span className="text-xs text-ink-faint">({q.destinationCountry})</span></td>
                        <td className="text-right"><Money value={q.sourceAmount} currency={q.sourceCurrency} strong /></td>
                        <td><div className="flex flex-wrap gap-1">{q.rulesFired.map((r) => <Badge key={r.ruleCode} tone="warn" title={JSON.stringify(r.details)}>{r.ruleName}</Badge>)}</div></td>
                        <td><StatusBadge value={q.approvalStatus} /></td>
                        <td className="whitespace-nowrap text-right">
                          <Button variant="ghost" size="sm" icon={RefreshCw} loading={rescreen.isPending && rescreen.variables === q.paymentId} onClick={() => rescreen.mutate(q.paymentId)}>Re-screen</Button>{' '}
                          <button className="btn-primary" onClick={() => { decide.reset(); setReason(''); setItem(q); }}>Decide</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </Card>

      <div className="mt-6">
        <Card title="Rules" padded={false}>
          <ErrorNote error={toggle.error ?? rescreen.error} />
          <QueryState query={rules}>
            {(list) => (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Rule</th><th>Parameters</th><th>When it fires</th><th>Version</th><th>Enabled</th></tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{r.description}</p></td>
                        <td className="num text-xs">{JSON.stringify(r.parameters)}</td>
                        <td><StatusBadge value={r.outcome} /></td>
                        <td className="num">{r.version}</td>
                        <td>
                          <label className="flex items-center gap-2">
                            <input type="checkbox" className="h-4 w-4" checked={r.enabled} disabled={toggle.isPending} onChange={() => toggle.mutate(r)} />
                            <span className="sr-only">Enable {r.name}</span>
                            {r.enabled ? 'On' : 'Off'}
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
      </div>

      <Modal open={Boolean(item)} title={`Compliance decision — ${item?.reference ?? ''}`} onClose={() => setItem(null)}>
        {item && (
          <div className="space-y-4">
            <Rows
              items={[
                ['Company', item.companyName],
                ['Beneficiary', item.beneficiaryName],
                ['Amount', <Money key="a" value={item.sourceAmount} currency={item.sourceCurrency} strong />],
                ['Rules fired', item.rulesFired.map((r) => r.ruleName).join(', ')],
              ]}
            />
            <div className="rounded-md bg-surface-sunken p-3 text-xs">
              {item.rulesFired.map((r) => <p key={r.ruleCode} className="num break-all"><span className="font-semibold">{r.ruleCode}</span> {JSON.stringify(r.details)}</p>)}
            </div>
            <Field label="Reason (required)" htmlFor="decision-reason">
              <textarea id="decision-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <p className="text-xs text-ink-muted">Clearing releases the payment once it also has its approval. Rejecting cancels it and returns the reserved funds.</p>
            <ErrorNote error={decide.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-danger" disabled={decide.isPending || reason.trim().length < 3} onClick={() => decide.mutate('REJECT')}>Reject</button>
              <button className="btn-primary" data-testid="compliance-clear" disabled={decide.isPending || reason.trim().length < 3} onClick={() => decide.mutate('CLEAR')}>Clear payment</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
