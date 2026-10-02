'use client';

import { KYB_STATUSES } from '@paybridge/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, Empty, ErrorNote, Field, Modal, PageHeader, Pagination, QueryState, Rows, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
import type { Company, Kyb } from '@/lib/types';

export default function AdminCompaniesPage() {
  const qc = useQueryClient();
  const [kybStatus, setKybStatus] = useState('');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<Company | null>(null);
  const [riskLevel, setRiskLevel] = useState('LOW');
  const [note, setNote] = useState('');
  const list = useQuery({ queryKey: ['admin-companies', kybStatus, page], queryFn: () => api.page<Company>(`/admin/companies${qs({ kybStatus, page, pageSize: 20 })}`) });
  const kyb = useQuery({ queryKey: ['kyb', review?.id], queryFn: () => api.get<Kyb>(`/kyb/${review!.id}`), enabled: Boolean(review) });
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => api.post(`/kyb/${review!.kybProfileId}/${decision}`, decision === 'approve' ? { riskLevel, note: note.trim() || undefined } : { reason: note.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-companies'] });
      qc.invalidateQueries({ queryKey: ['kyb'] });
      setReview(null);
    },
  });
  const openReview = (c: Company) => { decide.reset(); setNote(''); setRiskLevel(c.kybRiskLevel ?? 'LOW'); setReview(c); };

  return (
    <>
      <PageHeader title="Companies & KYB" description="Every tenant. Review KYB submissions: the mock provider's result is advisory, the decision is yours." />
      <Card padded={false}>
        <div className="border-b border-surface-line p-3">
          <label className="label" htmlFor="c-status">KYB status</label>
          <select id="c-status" className="input !w-52" value={kybStatus} onChange={(e) => { setKybStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {KYB_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </div>
        <QueryState query={list}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="No companies" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Company</th><th>Trade licence</th><th>KYB</th><th>Risk</th><th className="text-right">Users</th><th className="text-right">Payments</th><th>Registered</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {data.items.map((c) => (
                        <tr key={c.id}>
                          <td><p className="font-medium">{c.name}</p><p className="text-xs text-ink-faint">{c.contactEmail}</p></td>
                          <td className="num">{c.tradeLicenseNumber}<p className="text-xs text-ink-faint">expires {formatDate(c.tradeLicenseExpiry)}</p></td>
                          <td><StatusBadge value={c.kybStatus} /></td>
                          <td><StatusBadge value={c.kybRiskLevel} /></td>
                          <td className="num text-right">{c.memberCount}</td>
                          <td className="num text-right">{c.paymentCount}</td>
                          <td className="text-ink-muted">{formatDate(c.createdAt)}</td>
                          <td className="text-right">
                            <button className={c.kybStatus === 'UNDER_REVIEW' ? 'btn-primary' : 'btn-ghost'} onClick={() => openReview(c)}>{c.kybStatus === 'UNDER_REVIEW' ? 'Review' : 'View'}</button>
                          </td>
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

      <Modal open={Boolean(review)} title={`KYB — ${review?.name ?? ''}`} onClose={() => setReview(null)}>
        {review && (
          <div className="space-y-4">
            <Rows
              items={[
                ['Status', <StatusBadge key="s" value={kyb.data?.status ?? review.kybStatus} />],
                ['Business type', review.businessType],
                ['Registration no.', <span key="r" className="num">{review.registrationNumber}</span>],
                ['Address', review.registeredAddress],
                ['Submitted', formatDateTime(kyb.data?.submittedAt)],
                ['Mock provider', kyb.data?.verificationResult ? <span key="m"><StatusBadge value={kyb.data.verificationResult.result} /> <StatusBadge value={kyb.data.verificationResult.riskLevel} label={`${titleCase(kyb.data.verificationResult.riskLevel)} risk`} /></span> : '—'],
                ...(kyb.data?.verificationResult?.reasons.length ? ([['Provider reasons', <span key="p" className="num text-xs">{kyb.data.verificationResult.reasons.join(', ')}</span>]] as [string, React.ReactNode][]) : []),
                ...(kyb.data?.rejectionReason ? ([['Rejection reason', kyb.data.rejectionReason]] as [string, React.ReactNode][]) : []),
              ]}
            />
            {(kyb.data?.status ?? review.kybStatus) === 'UNDER_REVIEW' ? (
              <>
                <Field label="Risk level (on approval)" htmlFor="risk">
                  <select id="risk" className="input" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)}>
                    <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
                  </select>
                </Field>
                <Field label="Note — required to reject" htmlFor="kyb-note">
                  <textarea id="kyb-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <ErrorNote error={decide.error} />
                <div className="flex justify-end gap-2">
                  <button className="btn-danger" disabled={decide.isPending || note.trim().length < 3} onClick={() => decide.mutate('reject')}>Reject</button>
                  <button className="btn-primary" disabled={decide.isPending} onClick={() => decide.mutate('approve')} data-testid="kyb-approve">Approve KYB</button>
                </div>
              </>
            ) : (
              <p className="text-ink-muted">No decision is pending for this company.</p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
