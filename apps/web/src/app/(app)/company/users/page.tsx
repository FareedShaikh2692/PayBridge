'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Card, ErrorNote, Field, Modal, PageHeader, QueryState, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';

interface Member {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}
const ROLES = ['COMPANY_ADMIN', 'MAKER', 'APPROVER', 'VIEWER'] as const;
const ROLE_HELP: Record<string, string> = {
  COMPANY_ADMIN: 'Manages the company, users and wallet; can create and approve (never their own).',
  MAKER: 'Adds beneficiaries, requests quotes, creates payments. Cannot approve.',
  APPROVER: 'Approves or rejects payments created by others.',
  VIEWER: 'Read-only.',
};
const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter a name'),
  email: z.string().email('Enter a valid email address'),
  role: z.enum(ROLES),
  password: z.string().min(12, 'Use at least 12 characters'),
});
type Form = z.infer<typeof schema>;

export default function UsersPage() {
  const { me } = useAuth();
  const companyId = me?.company?.id;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ['users', companyId], queryFn: () => api.get<Member[]>(`/companies/${companyId}/users`), enabled: Boolean(companyId) });
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { role: 'MAKER' } });
  const add = useMutation({
    mutationFn: (v: Form) => api.post(`/companies/${companyId}/users`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      form.reset({ role: 'MAKER' });
      setOpen(false);
    },
  });
  const update = useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; role?: string; status?: string }) => api.patch(`/companies/${companyId}/users/${userId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  return (
    <>
      <PageHeader title="Users" description="Separate duties: the person who creates a payment is never the person who approves it." actions={<button className="btn-primary" onClick={() => setOpen(true)}>Add user</button>} />
      <ErrorNote error={update.error} />
      <Card padded={false}>
        <QueryState query={query}>
          {(members) => (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last sign-in</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>
                        <p className="font-medium">{m.fullName}{m.userId === me?.user.id && <span className="ml-1 text-xs text-ink-faint">(you)</span>}</p>
                        <p className="text-xs text-ink-muted">{m.email}</p>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.fullName}</label>
                        <select id={`role-${m.userId}`} className="input !w-auto !py-1" value={m.role} disabled={update.isPending} onChange={(e) => update.mutate({ userId: m.userId, role: e.target.value })}>
                          {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                        </select>
                      </td>
                      <td><StatusBadge value={m.status} /></td>
                      <td className="text-ink-muted">{formatDateTime(m.lastLoginAt)}</td>
                      <td className="text-right">
                        {m.userId !== me?.user.id && (
                          <button className="btn-ghost" disabled={update.isPending} onClick={() => update.mutate({ userId: m.userId, status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
                            {m.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Card>

      <Modal open={open} title="Add user" onClose={() => setOpen(false)}>
        <form onSubmit={form.handleSubmit((v) => add.mutate(v))} className="space-y-4" noValidate>
          <Field label="Full name" htmlFor="u-name" error={form.formState.errors.fullName?.message}>
            <input id="u-name" className="input" {...form.register('fullName')} />
          </Field>
          <Field label="Email" htmlFor="u-email" error={form.formState.errors.email?.message}>
            <input id="u-email" type="email" className="input" {...form.register('email')} />
          </Field>
          <Field label="Role" htmlFor="u-role" hint={ROLE_HELP[form.watch('role')]}>
            <select id="u-role" className="input" {...form.register('role')}>
              {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </Field>
          <Field label="Initial password" htmlFor="u-pass" error={form.formState.errors.password?.message} hint="The sandbox sends no invitation emails, so you set the first password here.">
            <input id="u-pass" type="password" autoComplete="new-password" className="input" {...form.register('password')} />
          </Field>
          <ErrorNote error={add.error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add user'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
