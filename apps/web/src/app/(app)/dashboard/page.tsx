'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ChevronRight, Clock, Send, TrendingUp, Wallet } from 'lucide-react';
import Link from 'next/link';
import { StatusDonut, VolumeChart } from '@/components/charts';
import { Alert, Badge, Card, CopyButton, EmptyState, Money, PageHeader, QueryState, Rows, Skeleton, Stat, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatAmount, formatDateTime } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Change in volume over the last 7 days against the 7 before, computed in integer minor units. */
function weeklyTrend(volume: DashboardSummary['volume']): { value: string; direction: 'up' | 'down' | 'flat' } | null {
  if (volume.length < 14) return null;
  const sum = (rows: DashboardSummary['volume']) => rows.reduce((acc, d) => acc + BigInt(d.amount.replace('.', '')), 0n);
  const previous = sum(volume.slice(0, 7));
  const current = sum(volume.slice(7));
  if (previous === 0n) return current === 0n ? { value: '0%', direction: 'flat' } : null;
  const tenths = ((current - previous) * 1000n) / previous; // percentage × 10
  const abs = tenths < 0n ? -tenths : tenths;
  return { value: `${abs / 10n}.${abs % 10n}%`, direction: tenths > 0n ? 'up' : tenths < 0n ? 'down' : 'flat' };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card p-5"><Skeleton className="w-24" /><Skeleton className="mt-4 h-8 w-36" /><Skeleton className="mt-4 w-40" /></div>)}</div>
      <div className="grid gap-6 lg:grid-cols-3"><div className="card h-80 p-5 lg:col-span-2"><Skeleton className="w-40" /><Skeleton className="mt-6 h-56 w-full" /></div><div className="card h-80 p-5"><Skeleton className="w-40" /><Skeleton className="mx-auto mt-8 h-36 w-36 !rounded-full" /></div></div>
      <div className="card p-5"><Skeleton className="w-40" /><Skeleton className="mt-5 h-4 w-full" /><Skeleton className="mt-3 h-4 w-full" /><Skeleton className="mt-3 h-4 w-2/3" /></div>
    </div>
  );
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary'), refetchInterval: 15_000 });
  const admin = me?.isPlatformAdmin;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me?.user.fullName.split(' ')[0] ?? ''}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{admin ? 'Platform operations · all tenants' : me?.company?.name}</span>
            <span aria-hidden="true">·</span>
            Environment <span className="rounded-md border border-warning-bright/30 bg-warning-soft px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-warning">Sandbox</span>
          </span>
        }
        actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>}
      />
      <QueryState query={query} skeleton={<DashboardSkeleton />}>
        {(d) => {
          const trend = weeklyTrend(d.volume);
          const volume = d.volume.reduce((acc, v) => acc + BigInt(v.amount.replace('.', '')), 0n);
          const volumeText = formatAmount(`${volume / 100n}.${String(volume % 100n).padStart(2, '0')}`);
          const totalPayments = d.statusDistribution.reduce((n, s) => n + s.count, 0);
          return (
            <div className="space-y-6">
              {me?.company && me.company.kybStatus !== 'APPROVED' && (
                <Alert tone="warn" title={`KYB is ${me.company.kybStatus.toLowerCase().replace('_', ' ')}`}>
                  Quotes and payments open once KYB is approved. <Link href="/company/kyb" className="link">Go to KYB</Link>
                </Alert>
              )}

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat className="col-span-2 lg:col-span-1" testId="stat-volume" icon={TrendingUp} label="Total volume · 14 days" unit="AED" value={volumeText} trend={trend} sub="last 7 days vs prior 7" />
                <Stat icon={Send} label="Payments" value={totalPayments} sub={`${d.totals.cancelledPayments} cancelled`} />
                <Stat icon={CheckCircle2} label="Completed" value={d.totals.completedPayments} sub={<>AED {formatAmount(d.totals.totalFees)} in fees</>} />
                <Stat icon={Clock} label="Pending" value={d.totals.pendingPayments} sub={`${d.totals.awaitingApproval} awaiting approval`} />
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <Card title="Payment volume" className="lg:col-span-2" actions={<span className="text-xs text-muted-foreground">AED · daily</span>}>
                  <VolumeChart data={d.volume} currency="AED" />
                </Card>
                <div className="space-y-6">
                  {d.balance && (
                    <div className="card relative overflow-hidden bg-navy-900 p-5 text-white" data-testid="stat-balance">
                      <div aria-hidden="true" className="absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/25 blur-2xl" />
                      <p className="relative flex items-center gap-2 text-[13px] font-medium text-white/70"><Wallet aria-hidden="true" className="h-4 w-4" /> Available balance</p>
                      <p className="num relative mt-3 text-[30px] font-semibold leading-none tracking-[-0.02em]"><span className="mr-1.5 text-sm font-medium tracking-normal text-white/60">AED</span>{formatAmount(d.balance.available)}</p>
                      <p className="relative mt-3 text-xs text-white/60">AED {formatAmount(d.balance.reserved)} reserved for payments in flight</p>
                    </div>
                  )}
                  <Card title="Payment status">
                    <StatusDonut data={d.statusDistribution} layout="stack" size={132} />
                  </Card>
                </div>
              </div>

              {d.alerts.length > 0 && (
                <Card title="Needs attention" padded={false}>
                  <ul className="divide-y divide-border" data-testid="alerts">
                    {d.alerts.map((a) => (
                      <li key={a.message}>
                        <Link href={a.href} className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors duration-150 hover:bg-background">
                          <span className="flex items-center gap-3">
                            <Badge tone={a.level === 'danger' ? 'bad' : a.level === 'warning' ? 'warn' : 'info'} caps>{a.level === 'danger' ? 'Action' : a.level === 'warning' ? 'Review' : 'Pending'}</Badge>
                            <span className="font-medium">{a.message}</span>
                          </span>
                          <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="grid gap-6 xl:grid-cols-3">
                <Card title="Recent payments" className="xl:col-span-2" padded={false} actions={<Link href="/payments" className="link text-xs">View all</Link>}>
                  {d.recentPayments.length === 0 ? (
                    <EmptyState icon={Send} title="No payments yet" action={can('payment.create') && <Link href="/payments/new" className="btn-primary">Create payment</Link>}>Create your first sandbox payment.</EmptyState>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr><th>Payment ID</th><th>Beneficiary</th><th className="text-right">Amount</th><th>Currency</th><th>Status</th><th className="hidden lg:table-cell">Created</th></tr>
                        </thead>
                        <tbody>
                          {d.recentPayments.map((p) => (
                            <tr key={p.id}>
                              <td>
                                <span className="flex items-center gap-1"><Link href={`/payments/${p.id}`} className="link num">{p.reference}</Link><CopyButton value={p.reference} label="Copy payment ID" /></span>
                              </td>
                              <td className="max-w-[180px] truncate">{p.beneficiary?.name}{admin && <p className="truncate text-xs text-muted-foreground">{p.companyName}</p>}</td>
                              <td className="num text-right font-medium">{formatAmount(p.sourceAmount)}</td>
                              <td className="text-muted-foreground">{p.sourceCurrency} → {p.destinationCurrency}</td>
                              <td><StatusBadge value={p.status} label={p.displayStatus} /></td>
                              <td className="num hidden whitespace-nowrap text-muted-foreground lg:table-cell">{formatDateTime(p.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>

                <div className="space-y-6">
                  <Card title="FX · AED → INR" actions={<Badge tone="neutral">Mock rate</Badge>}>
                    <p className="num text-[28px] font-semibold leading-none tracking-[-0.02em]">{d.fx.customerRate}</p>
                    <p className="mt-2 text-xs text-muted-foreground">INR per AED, your rate</p>
                    <div className="mt-4">
                      <Rows
                        items={[
                          ['Mid-market', <span key="m" className="num">{d.fx.midMarketRate}</span>],
                          ['Spread', <span key="s" className="num">{d.fx.spreadPercentage}%</span>],
                          ['Fee per payment', <Money key="f" value={d.fx.feeAmount} currency="AED" />],
                          ['Quote lock', `${d.fx.quoteTtlSeconds} seconds`],
                        ]}
                      />
                    </div>
                  </Card>
                  {d.platform && (
                    <Card title="Operations">
                      <Rows
                        items={[
                          ['KYB awaiting review', <Link key="k" href="/admin/companies" className="link num">{d.platform.kybPending}</Link>],
                          ['Dead-lettered jobs', <Link key="d" href="/admin/webhooks" className="link num">{d.platform.deadLetters}</Link>],
                          ['Last reconciliation', d.platform.lastReconciliation ? <Link key="r" href="/admin/reconciliation" className="link">{d.platform.lastReconciliation.issueCount} of {d.platform.lastReconciliation.totalItems} need attention</Link> : 'Not run yet'],
                        ]}
                      />
                    </Card>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
