'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, PageHeader, Rows, StatusBadge, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';
import type { Company } from '@/lib/types';

/** Account, workspace and sandbox settings. Only what is real is shown; nothing here is decorative. */
export default function SettingsPage() {
  const { me, can, reload } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const companyId = me?.company?.id;
  const company = useQuery({ queryKey: ['company', companyId], queryFn: () => api.get<Company>(`/companies/${companyId}`), enabled: Boolean(companyId) });
  const health = useQuery({ queryKey: ['health-detail'], queryFn: async () => (await (await fetch('/health/ready')).json())?.data as { status: string; checks: Record<string, string> } });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch<Company>(`/companies/${companyId}`, { makerCheckerEnabled: enabled }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['company'] }), reload()]);
      toast('Approval policy updated.');
    },
  });
  if (!me) return null;

  return (
    <>
      <PageHeader title="Settings" description="Your account, your workspace's approval policy, and the sandbox environment." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <Rows items={[['Name', me.user.fullName], ['Email', <span key="e" className="num">{me.user.email}</span>], ['Role', me.role ? titleCase(me.role) : '—'], ['Permissions', `${me.permissions.length} granted`]]} />
          <p className="mt-4 text-xs text-muted-foreground">Password changes and multi-factor authentication are not part of the sandbox.</p>
        </Card>
        {companyId && (
          <Card title="Approval policy">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" checked={company.data?.makerCheckerEnabled ?? false} disabled={!can('company.update') || toggle.isPending || company.isLoading} onChange={(e) => toggle.mutate(e.target.checked)} />
              <span>
                <span className="font-medium">Require a second person to approve every payment</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">Maker-checker. The person who creates a payment can never approve it. {can('company.update') ? '' : 'Only a company administrator can change this.'}</span>
              </span>
            </label>
          </Card>
        )}
        <Card title="Sandbox environment">
          <Rows
            items={[
              ['Mode', <span key="m" className="rounded-md border border-warning-bright/30 bg-warning-soft px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-warning">Sandbox</span>],
              ['API status', <StatusBadge key="s" value={health.data?.status === 'ok' ? 'ACTIVE' : health.data?.status === 'degraded' ? 'REVIEW' : health.isLoading ? null : 'FAILED'} label={health.data?.status === 'ok' ? 'Connected' : health.data?.status === 'degraded' ? 'Degraded' : 'Unavailable'} />],
              ['Database', titleCase(health.data?.checks?.database ?? '—')],
              ['Queue store (Redis)', titleCase(health.data?.checks?.redis ?? '—')],
              ['Money movement', 'None — all providers are mocks'],
            ]}
          />
        </Card>
      </div>
    </>
  );
}
