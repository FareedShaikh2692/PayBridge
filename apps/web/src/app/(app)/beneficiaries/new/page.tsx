'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ACCOUNT_NUMBER_REGEX, IFSC_REGEX } from '@paybridge/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Card, ErrorNote, Field, PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import type { Beneficiary } from '@/lib/types';

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the beneficiary name').max(140),
  bankName: z.string().trim().min(2, 'Enter the bank name').max(140),
  accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_REGEX, 'Account number must be 9 to 18 digits'),
  ifsc: z.string().trim().toUpperCase().regex(IFSC_REGEX, 'IFSC is 4 letters, a zero, then 6 letters or digits'),
  accountHolderName: z.string().trim().min(2, 'Enter the account holder name').max(140),
});
type Form = z.infer<typeof schema>;

function NewBeneficiary() {
  const router = useRouter();
  const returnTo = useSearchParams().get('returnTo');
  const qc = useQueryClient();
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const create = useMutation({
    mutationFn: (v: Form) => api.post<Beneficiary>('/beneficiaries', { ...v, country: 'IN' }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['beneficiaries'] });
      router.push(returnTo === 'payment' && b.status === 'ACTIVE' ? `/payments/new?beneficiaryId=${b.id}` : `/beneficiaries/${b.id}`);
    },
  });

  return (
    <>
      <PageHeader title="Add beneficiary" back={{ href: '/beneficiaries', label: 'Beneficiaries' }} />
      <Alert tone="info" title="Use test details only">Enter a made-up account number and the test IFSC <span className="num font-semibold">TEST0001234</span>. Never enter a real account.</Alert>
      <div className="mt-4 max-w-2xl">
        <Card title="Beneficiary details">
          <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Beneficiary name" htmlFor="name" error={formState.errors.name?.message}>
                  <input id="name" className="input" {...register('name')} />
                </Field>
              </div>
              <Field label="Country">
                <input className="input" value="India (IN)" disabled readOnly />
              </Field>
              <Field label="Bank name" htmlFor="bankName" error={formState.errors.bankName?.message}>
                <input id="bankName" className="input" {...register('bankName')} />
              </Field>
              <Field label="Account number" htmlFor="accountNumber" error={formState.errors.accountNumber?.message} hint="9–18 digits. Stored encrypted; shown masked afterwards.">
                <input id="accountNumber" className="input num" inputMode="numeric" autoComplete="off" {...register('accountNumber')} />
              </Field>
              <Field label="IFSC" htmlFor="ifsc" error={formState.errors.ifsc?.message} hint="e.g. TEST0001234">
                <input id="ifsc" className="input num uppercase" autoComplete="off" maxLength={11} {...register('ifsc')} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Account holder name" htmlFor="accountHolderName" error={formState.errors.accountHolderName?.message}>
                  <input id="accountHolderName" className="input" {...register('accountHolderName')} />
                </Field>
              </div>
            </div>
            <ErrorNote error={create.error} />
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Saving…' : 'Save beneficiary'}
            </button>
          </form>
        </Card>
        <p className="mt-3 text-xs text-ink-faint">
          Names are screened by a mock provider. For testing: a name containing <span className="num">TEST-SANCTION</span> is blocked, <span className="num">TEST-PEP</span> sends payments to compliance review,
          and <span className="num">TEST-FAIL</span> makes the mock payout fail.
        </p>
      </div>
    </>
  );
}

export default function NewBeneficiaryPage() {
  return (
    <Suspense>
      <NewBeneficiary />
    </Suspense>
  );
}
