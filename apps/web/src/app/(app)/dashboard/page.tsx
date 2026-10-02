'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { StatusDistribution, VolumeChart } from '@/components/charts';
import { Alert, Card, Empty, Money, PageHeader, QueryState, Rows, Stat, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatAmount, formatDateTime } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';

export default function DashboardPage() {
  const { me, can } = useAuth();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardSummary>('/dashboard/summary'), refetchInterval: 15_000 });
  const admin = me?.isPlatformAdmin;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={admin ? 'All tenants at a glance.' : `Welcome back, ${me?.user.fullName.split(' ')[0]}.`}
        actions={can('payment.create') && <Link href="/payments/new" className="btn-primary">New payment</Link>}
      />
      <QueryState query={query}>
        {(d) => (
          <div className="space-y-6">
            {me?.company && me.company.kybStatus !== 'APPROVED' && (
              <Alert tone="warn" title={`KYB is ${me.company.kybStatus.toLowerCase().replace('_', ' ')}`}>
                Quotes and payments open once KYB is approved. <Link href="/company/kyb" className="link">Go to KYB</Link>
              </Alert>
            )}
            {d.alerts.length > 0 && (
              <div className="space-y-2" data-testid="alerts">
                {d.alerts.map((a) => (
                  <Alert key={a.message} tone={a.level === 'danger' ? 'bad' : a.level === 'warning' ? 'warn' : 'info'}>
                    {a.message} — <Link href={a.href} className="link">review</Link>
                  </Alert>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {d.balance ? (
                <Stat testId="stat-balance" label="Available AED balance" value={formatAmount(d.balance.available)} sub={<>AED {formatAmount(d.balance.reserved)} reserved for payments in flight</>} />
              ) : (
                <Stat label="Companies" value={d.platform?.companies ?? 0} sub={`${d.platform?.kybPending ?? 0} awaiting KYB review`} />
              )}
              <Stat label="Total sent" value={formatAmount(d.totals.totalSent)} sub={<>AED, paid payments · INR {formatAmount(d.totals.totalDelivered)} delivered</>} />
              <Stat label="Total fees" value={formatAmount(d.totals.totalFees)} sub="AED, on paid payments" />
              <Stat label="Pending payments" value={d.totals.pendingPayments} sub={`${d.totals.awaitingApproval} awaiting approval`} />
              <Stat label="Completed payments" value={d.totals.completedPayments} />
              <Stat label="Failed payments" value={d.totals.failedPayments} sub="Refunded in full" />
              <Stat label="Compliance reviews" value={d.totals.complianceReviews} sub="Open now" />
              <Stat label="Cancelled" value={d.totals.cancelledPayments} />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Payment volume" className="lg:col-span-2">
                <VolumeChart data={d.volume} currency="AED" />
              </Card>
              <Card title="Payment status distribution">
                <StatusDistribution data={d.statusDistribution} />
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <Card title="Recent transactions" className="lg:col-span-2" padded={false} actions={<Link href="/payments" className="link text-xs">View all</Link>}>
                {d.recentPayments.length === 0 ? (
                  <Empty title="No payments yet">{can('payment.create') && <Link href="/payments/new" className="link">Create the first one</Link>}</Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Beneficiary</th>
                          <th className="text-right">You send</th>
                          <th className="text-right">Recipient gets</th>
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
                            <td className="text-right"><Money value={p.destinationAmount} currency={p.destinationCurrency} /></td>
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
