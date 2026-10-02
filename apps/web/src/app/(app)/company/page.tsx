'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Card, ErrorNote, Field, Loading, Money, PageHeader, Rows, StatusBadge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Balance, Company } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the company name').max(200),
  tradeLicenseNumber: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/, '4–40 letters, digits or hyphens'),
  tradeLicenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date').refine((d) => new Date(d) > new Date(), 'The licence must not be expired'),
  registrationNumber: z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/, '4–40 letters, digits or hyphens'),
  businessType: z.string().trim().min(2, 'Enter the business type').max(120),
  registeredAddress: z.string().trim().min(5, 'Enter the registered address').max(500),
  contactEmail: z.string().email('Enter a valid email address'),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number'),
  website: z.string().trim().url('Enter a full URL, e.g. https://example.test').or(z.literal('')).optional(),
});
type Form = z.infer<typeof schema>;

const FIELDS: { name: keyof Form; label: string; type?: string; hint?: string; span?: boolean; frozen: boolean }[] = [
  { name: 'name', label: 'Company name', frozen: true, span: true },
  { name: 'tradeLicenseNumber', label: 'Trade licence number', frozen: true, hint: 'Use a made-up value such as TEST-TL-123456' },
  { name: 'tradeLicenseExpiry', label: 'Trade licence expiry', type: 'date', frozen: true },
  { name: 'registrationNumber', label: 'Registration number', frozen: true },
  { name: 'businessType', label: 'Business type', frozen: true },
  { name: 'registeredAddress', label: 'Registered address', frozen: true, span: true },
  { name: 'contactEmail', label: 'Contact email', type: 'email', frozen: false },
  { name: 'contactPhone', label: 'Contact phone', frozen: false },
  { name: 'website', label: 'Website (optional)', frozen: false, span: true },
];

function CompanyForm({ company, onSaved }: { company: Company | null; onSaved: () => void }) {
  const { reload } = useAuth();
  const locked = company ? !['DRAFT', 'REJECTED', 'EXPIRED'].includes(company.kybStatus) : false;
  const { register, handleSubmit, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: company ? { ...company, website: company.website ?? '' } : { tradeLicenseExpiry: '' },
  });
  const save = useMutation({
    mutationFn: (values: Form) => {
      const body = { ...values, website: values.website || undefined };
      if (!company) return api.post<Company>('/companies', { ...body, country: 'AE' });
      // After KYB submission only contact details may change; send just those.
      const editable = FIELDS.filter((f) => !locked || !f.frozen).map((f) => f.name);
      return api.patch<Company>(`/companies/${company.id}`, Object.fromEntries(Object.entries(body).filter(([k, v]) => editable.includes(k as keyof Form) && v !== undefined)));
    },
    onSuccess: async () => {
      await reload();
      onSaved();
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name} className={f.span ? 'sm:col-span-2' : undefined}>
            <Field label={f.label} htmlFor={f.name} error={formState.errors[f.name]?.message} hint={f.hint}>
              <input id={f.name} type={f.type ?? 'text'} className="input" disabled={locked && f.frozen} {...register(f.name)} />
            </Field>
          </div>
        ))}
        <Field label="Country">
          <input className="input" value="United Arab Emirates (AE)" disabled readOnly />
        </Field>
      </div>
      {locked && <p className="text-xs text-ink-muted">Legal details are frozen while KYB is {company?.kybStatus.toLowerCase().replace('_', ' ')}. Contact details can still be updated.</p>}
      <ErrorNote error={save.error} />
      {save.isSuccess && company && <Alert tone="good">Saved.</Alert>}
      <button type="submit" className="btn-primary" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : company ? 'Save changes' : 'Register company'}
      </button>
    </form>
  );
}

function TopUp({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('100000.00');
  const toast = useToast();
  const topup = useMutation({
    mutationFn: () => api.post('/sandbox/wallet/topup', { amount }, { idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => {
      toast('Wallet topped up (simulated).');
      qc.invalidateQueries();
    },
  });
  return (
    <form
      className="mt-3 flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        topup.mutate();
      }}
    >
      <div className="flex-1">
        <label className="label" htmlFor="topup">Simulated top-up (AED)</label>
        <input id="topup" className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} pattern="^\d+(\.\d{1,2})?$" />
      </div>
      <button className="btn-secondary" disabled={topup.isPending} data-company={companyId}>
        {topup.isPending ? 'Adding…' : 'Add funds'}
      </button>
      {topup.error ? <div className="basis-full"><ErrorNote error={topup.error} /></div> : null}
    </form>
  );
}

export default function CompanyPage() {
  const { me, can } = useAuth();
  const companyId = me?.company?.id;
  const company = useQuery({ queryKey: ['company', companyId], queryFn: () => api.get<Company>(`/companies/${companyId}`), enabled: Boolean(companyId) });
  const balance = useQuery({ queryKey: ['balance', companyId], queryFn: () => api.get<Balance>(`/ledger/${companyId}/balance`), enabled: Boolean(companyId) });
  const qc = useQueryClient();
  const [makerChecker, setMakerChecker] = useState<boolean | null>(null);
  useEffect(() => setMakerChecker(company.data?.makerCheckerEnabled ?? null), [company.data]);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch<Company>(`/companies/${companyId}`, { makerCheckerEnabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company'] }),
  });

  if (!me) return null;

  if (!me.company) {
    return (
      <>
        <PageHeader title="Register your company" description="Step 1 of onboarding. You become the company administrator; KYB follows." />
        <Alert tone="info" title="Use fictional details">This is a sandbox. Do not enter a real trade licence, address or phone number.</Alert>
        <div className="mt-4">
          <Card title="Company details">
            <CompanyForm company={null} onSaved={() => (window.location.href = '/company/kyb')} />
          </Card>
        </div>
      </>
    );
  }

  if (company.isLoading) return <Loading />;
  const c = company.data;
  return (
    <>
      <PageHeader title="Company profile" description={c?.name} actions={<Link href="/company/kyb" className="btn-secondary">KYB status</Link>} />
      <ErrorNote error={company.error} />
      {c && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Company details" className="lg:col-span-2">
            {can('company.update') ? (
              <CompanyForm key={c.kybStatus} company={c} onSaved={() => qc.invalidateQueries({ queryKey: ['company'] })} />
            ) : (
              <Rows
                items={[
                  ['Name', c.name],
                  ['Trade licence', <span key="t" className="num">{c.tradeLicenseNumber}</span>],
                  ['Licence expiry', formatDate(c.tradeLicenseExpiry)],
                  ['Registration number', <span key="r" className="num">{c.registrationNumber}</span>],
                  ['Business type', c.businessType],
                  ['Registered address', c.registeredAddress],
                  ['Contact', `${c.contactEmail} · ${c.contactPhone}`],
                ]}
              />
            )}
          </Card>
          <div className="space-y-6">
            <Card title="Status">
              <Rows
                items={[
                  ['KYB', <StatusBadge key="k" value={c.kybStatus} />],
                  ['Risk level', <StatusBadge key="r" value={c.kybRiskLevel} />],
                  ['Registered', formatDate(c.createdAt)],
                ]}
              />
            </Card>
            <Card title="Wallet (simulated)">
              {balance.data?.provisioned ? (
                <>
                  <Rows
                    items={[
                      ['Available', <Money key="a" value={balance.data.available} currency="AED" strong />],
                      ['Reserved', <Money key="r" value={balance.data.reserved} currency="AED" />],
                    ]}
                  />
                  {can('wallet.topup') && <TopUp companyId={c.id} />}
                  <p className="mt-2 text-xs text-ink-faint">A top-up posts a ledger entry. No money moves anywhere.</p>
                </>
              ) : (
                <p className="text-ink-muted">The wallet is created when KYB is approved.</p>
              )}
            </Card>
            {can('company.update') && (
              <Card title="Maker-checker">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={makerChecker ?? false} disabled={toggle.isPending} onChange={(e) => { setMakerChecker(e.target.checked); toggle.mutate(e.target.checked); }} />
                  <span>
                    Require a second person to approve every payment
                    <span className="block text-xs text-ink-muted">The person who creates a payment can never approve it.</span>
                  </span>
                </label>
                <ErrorNote error={toggle.error} />
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
