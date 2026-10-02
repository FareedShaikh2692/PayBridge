'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Banknote, CheckCircle2, ChevronRight, CircleSlash, Clock, Receipt, ShieldAlert, Wallet, XCircle } from 'lucide-react';
import { StatusDonut, VolumeChart } from '@/components/charts';
import { Alert, Badge, Card, EmptyState, Money, PageHeader, QueryState, Rows, Skeleton, Stat, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatAmount, formatDateTime } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="card p-5"><Skeleton className="w-24" /><Skeleton className="mt-3 h-7 w-32" /><Skeleton className="mt-3 w-40" /></div>)}</div>
      <div className="grid gap-6 lg:grid-cols-3"><div className="card h-72 p-5 lg:col-span-2"><Skeleton className="w-40" /><Skeleton className="mt-6 h-48 w-full" /></div><div className="card h-72 p-5"><Skeleton className="w-40" /><Skeleton className="mx-auto mt-8 h-36 w-36 !rounded-full" /></div></div>
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
        title="Dashboard"
        description={admin ? 'All tenants at a glance.' : `${greeting()}, ${me?.user.fullName.split(' ')[0]}.`}
        actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment</Link>}
      />
      <QueryState query={query} skeleton={<DashboardSkeleton />}>
        {(d) => (
          <div className="space-y-6">
            {me?.company && me.company.kybStatus !== 'APPROVED' && (
              <Alert tone="warn" title={`KYB is ${me.company.kybStatus.toLowerCase().replace('_', ' ')}`}>
                Quotes and payments open once KYB is approved. <Link href="/company/kyb" className="link">Go to KYB</Link>
              </Alert>
            )}
            {d.alerts.length > 0 && (
              <Card title="Needs attention" padded={false}>
                <ul className="divide-y divide-border" data-testid="alerts">
                  {d.alerts.map((a) => (
                    <li key={a.message}>
                      <Link href={a.href} className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors duration-150 hover:bg-muted/60">
                        <span className="flex items-center gap-3">
                          <Badge tone={a.level === 'danger' ? 'bad' : a.level === 'warning' ? 'warn' : 'info'}>{a.level === 'danger' ? 'Action' : a.level === 'warning' ? 'Review' : 'Pending'}</Badge>
                          <span className="font-medium">{a.message}</span>
                        </span>
                        <ChevronRight aria-hidden="true" className="h-4 w-4 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {d.balance ? (
                <Stat testId="stat-balance" icon={Wallet} label="Available AED balance" value={formatAmount(d.balance.available)} sub={<>AED {formatAmount(d.balance.reserved)} reserved for payments in flight</>} />
              ) : (
                <Stat label="Companies" value={d.platform?.companies ?? 0} sub={`${d.platform?.kybPending ?? 0} awaiting KYB review`} />
              )}
              <Stat icon={Banknote} label="Total sent" value={formatAmount(d.totals.totalSent)} sub={<>AED, paid payments · INR {formatAmount(d.totals.totalDelivered)} delivered</>} />
              <Stat icon={Receipt} label="Total fees" value={formatAmount(d.totals.totalFees)} sub="AED, on paid payments" />
              <Stat icon={Clock} label="Pending payments" value={d.totals.pendingPayments} sub={`${d.totals.awaitingApproval} awaiting approval`} />
              <Stat icon={CheckCircle2} label="Completed payments" value={d.totals.completedPayments} />
              <Stat icon={XCircle} label="Failed payments" value={d.totals.failedPayments} sub="Refunded in full" />
              <Stat icon={ShieldAlert} label="Compliance reviews" value={d.totals.complianceReviews} sub="Open now" />
              <Stat icon={CircleSlash} label="Cancelled" value={d.totals.cancelledPayments} />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Payment volume" className="lg:col-span-2">
                <VolumeChart data={d.volume} currency="AED" />
              </Card>
              <Card title="Payment status">
                <StatusDonut data={d.statusDistribution} layout="stack" />
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Recent transactions" className="lg:col-span-2" padded={false} actions={<Link href="/payments" className="link text-xs">View all</Link>}>
                {d.recentPayments.length === 0 ? (
                  <EmptyState title="No payments yet" action={can('payment.create') && <Link href="/payments/new" className="btn-primary">Create payment</Link>}>Once you create a simulated payment, your transaction history will appear here.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Beneficiary</th>
                          <th className="text-right">You send</th>
                          <th className="hidden text-right 2xl:table-cell">Recipient gets</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recentPayments.map((p) => (
                          <tr key={p.id}>
                            <td>
                              <Link href={`/payments/${p.id}`} className="link num">{p.reference}</Link>
                              <p className="text-xs text-ink-faint">{formatDateTime(p.createdAt)}</p>
                            </td>
                            <td>
                              {p.beneficiary?.name}
                              {admin && <p className="text-xs text-ink-faint">{p.companyName}</p>}
                            </td>
                            <td className="text-right"><Money value={p.sourceAmount} currency={p.sourceCurrency} /></td>
                            <td className="hidden text-right 2xl:table-cell"><Money value={p.destinationAmount} currency={p.destinationCurrency} /></td>
                            <td><StatusBadge value={p.status} label={p.displayStatus} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <div className="space-y-6">
                <Card title="FX rate — AED → INR">
                  <Rows
                    items={[
                      ['Mid-market rate', <span key="m" className="num">{d.fx.midMarketRate}</span>],
                      ['Spread', <span key="s" className="num">{d.fx.spreadPercentage} %</span>],
                      ['Your rate', <span key="c" className="num">{d.fx.customerRate}</span>],
                      ['Fee per payment', <Money key="f" value={d.fx.feeAmount} currency="AED" />],
                      ['Quote valid for', `${d.fx.quoteTtlSeconds} seconds`],
                    ]}
                  />
                  <p className="mt-2 text-xs text-ink-faint">Mock rate, fixed by configuration. Not market data.</p>
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
        )}
      </QueryState>
    </>
  );
}
