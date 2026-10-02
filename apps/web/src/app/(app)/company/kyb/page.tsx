'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Card, ErrorNote, PageHeader, QueryState, Rows, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Kyb } from '@/lib/types';

const STEPS = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED'];
const HELP: Record<string, string> = {
  DRAFT: 'Check the company details, then submit them for review.',
  SUBMITTED: 'Submitted. The mock verification is running.',
  UNDER_REVIEW: 'The mock provider has responded. A platform administrator now makes the decision.',
  APPROVED: 'Approved. The wallet is open and the company can quote and pay.',
  REJECTED: 'Rejected. Correct the company details to reopen the profile, then submit again.',
  EXPIRED: 'The trade licence has lapsed. Update the licence details to reopen the profile, then submit again.',
};

export default function KybPage() {
  const { me, can, reload } = useAuth();
  const qc = useQueryClient();
  const companyId = me?.company?.id;
  const query = useQuery({ queryKey: ['kyb', companyId], queryFn: () => api.get<Kyb>(`/kyb/${companyId}`), enabled: Boolean(companyId), refetchInterval: (q) => (q.state.data?.status === 'UNDER_REVIEW' ? 5_000 : false) });
  const submit = useMutation({
    mutationFn: () => api.post<Kyb>('/kyb/submit'),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['kyb'] }), reload()]);
    },
  });

  return (
    <>
      <PageHeader title="KYB — Know Your Business" description="A simulation of business verification. A deterministic mock provider responds, then a platform administrator decides." back={{ href: '/company', label: 'Company profile' }} />
      <QueryState query={query}>
        {(k) => {
          const stepIndex = STEPS.indexOf(k.status);
          return (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Status" className="lg:col-span-2">
                <ol className="mb-4 flex flex-wrap gap-2" aria-label="KYB progress">
                  {STEPS.map((s, i) => (
                    <li key={s} className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium ${stepIndex >= i ? 'border-accent/40 bg-accent-soft text-accent' : 'border-surface-line text-ink-faint'}`}>
                      <span className="num">{i + 1}</span> {s.replace('_', ' ').toLowerCase()}
                    </li>
                  ))}
                </ol>
                <div className="flex items-center gap-2">
                  <span className="text-ink-muted">Current status</span> <StatusBadge value={k.status} testId="kyb-status" />
                </div>
                <p className="mt-2">{HELP[k.status]}</p>
                {k.status === 'REJECTED' && k.rejectionReason && (
                  <div className="mt-3"><Alert tone="bad" title="Reason given">{k.rejectionReason}</Alert></div>
                )}
                <ErrorNote error={submit.error} />
                <div className="mt-4 flex flex-wrap gap-2">
                  {k.status === 'DRAFT' && can('kyb.submit') && (
                    <button className="btn-primary" onClick={() => submit.mutate()} disabled={submit.isPending}>
                      {submit.isPending ? 'Submitting…' : 'Submit KYB'}
                    </button>
                  )}
                  {(k.status === 'REJECTED' || k.status === 'EXPIRED' || k.status === 'DRAFT') && <Link href="/company" className="btn-secondary">Edit company details</Link>}
                  {k.status === 'APPROVED' && can('payment.create') && <Link href="/payments/new" className="btn-primary">Create a payment</Link>}
                </div>
              </Card>
              <Card title="Review record">
                <Rows
                  items={[
                    ['Submitted', formatDateTime(k.submittedAt)],
                    ['Reviewed', formatDateTime(k.reviewedAt)],
                    ['Reviewed by', k.reviewedByName ?? (k.status === 'APPROVED' ? 'Automatic (mock)' : '—')],
                    ['Risk level', <StatusBadge key="r" value={k.riskLevel} />],
                    ['Valid until', formatDate(k.expiresAt)],
                  ]}
                />
                {k.verificationResult && (
                  <div className="mt-3 rounded-md bg-surface-sunken p-3 text-xs">
                    <p className="font-semibold">Mock provider result</p>
                    <p className="mt-1">
                      <StatusBadge value={k.verificationResult.result} /> <span className="text-ink-muted">checked {formatDateTime(k.verificationResult.checkedAt)}</span>
                    </p>
                    {k.verificationResult.reasons.length > 0 && <p className="mt-1 num">{k.verificationResult.reasons.join(', ')}</p>}
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
