'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { FileText, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert, Button, Card, EmptyState, ErrorNote, PageHeader, QueryState, Rows, Select, StatusBadge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, titleCase } from '@/lib/format';
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

const DOCUMENT_TYPES = ['TRADE_LICENSE', 'MEMORANDUM_OF_ASSOCIATION', 'OWNER_ID', 'PROOF_OF_ADDRESS', 'OTHER'];

/**
 * KYB documents, metadata only. The chosen file never leaves the browser: its SHA-256 is computed locally and
 * only the name, size and checksum are recorded.
 */
function Documents({ kyb, canEdit }: { kyb: Kyb; canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState(DOCUMENT_TYPES[0]);
  const open = ['DRAFT', 'REJECTED', 'EXPIRED'].includes(kyb.status);
  const add = useMutation({
    mutationFn: async (file: File) => {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const fileName = file.name.replace(/[^\w .()-]/g, '_').slice(0, 200) || 'document';
      return api.post('/kyb/documents', { documentType: type, fileName, checksum, sizeBytes: file.size });
    },
    onSuccess: () => {
      toast('Document recorded.');
      qc.invalidateQueries({ queryKey: ['kyb'] });
    },
    onSettled: () => {
      if (input.current) input.current.value = '';
    },
  });
  return (
    <Card title="Supporting documents" padded={false} actions={<span className="text-xs text-muted-foreground">Metadata only — files are never uploaded</span>}>
      {kyb.documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents recorded">Add a trade licence or other supporting document before submitting. Use a dummy file: only its name, size and checksum are kept.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table" data-testid="kyb-documents">
            <thead><tr><th>Document</th><th>File</th><th className="text-right">Size</th><th>Checksum (SHA-256)</th><th>Added</th></tr></thead>
            <tbody>
              {kyb.documents.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{titleCase(d.documentType)}</td>
                  <td>{d.fileName}</td>
                  <td className="num text-right">{d.sizeBytes !== null ? `${Math.max(1, Math.round(d.sizeBytes / 1024))} KB` : '—'}</td>
                  <td className="num text-xs text-muted-foreground">{d.checksum ? `${d.checksum.slice(0, 16)}…` : '—'}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{formatDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <div className="border-t border-border p-4">
          {open ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="doc-type">Document type</label>
                <Select id="doc-type" value={type} onChange={(e) => setType(e.target.value)} className="!w-64">
                  {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
                </Select>
              </div>
              <input ref={input} type="file" className="sr-only" id="doc-file" aria-label="Choose a document" onChange={(e) => e.target.files?.[0] && add.mutate(e.target.files[0])} />
              <Button variant="secondary" icon={Upload} loading={add.isPending} loadingLabel="Recording…" onClick={() => input.current?.click()}>Choose file</Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Documents can be added only while the profile is in draft.</p>
          )}
          <ErrorNote error={add.error} />
        </div>
      )}
    </Card>
  );
}

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
            <div className="space-y-6">
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
            <Documents kyb={k} canEdit={can('kyb.submit')} />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
