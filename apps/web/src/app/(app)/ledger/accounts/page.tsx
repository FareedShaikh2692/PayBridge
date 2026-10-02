'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, Empty, Money, PageHeader, Pagination, QueryState } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, titleCase } from '@/lib/format';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  currency: string;
  balance: string;
  companyName: string | null;
  scope: 'SYSTEM' | 'COMPANY';
}
interface Statement {
  account: Account;
  entries: { id: string; direction: 'DEBIT' | 'CREDIT'; amount: string; currency: string; balanceAfter: string; createdAt: string; transaction: { type: string; description: string; paymentId: string | null } }[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export default function AccountsPage() {
  const { me } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const accounts = useQuery({ queryKey: ['ledger-accounts'], queryFn: () => api.get<Account[]>('/ledger/accounts') });
  const statement = useQuery({ queryKey: ['ledger-account', selected, page], queryFn: () => api.get<Statement>(`/ledger/accounts/${selected}${qs({ page, pageSize: 15 })}`), enabled: Boolean(selected) });

  return (
    <>
      <PageHeader title="Ledger accounts" description="The chart of accounts. Balances are the sum of each account's entries; select an account to see its statement." back={{ href: '/ledger', label: 'Ledger' }} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Chart of accounts" className="lg:col-span-2" padded={false}>
          <QueryState query={accounts}>
            {(list) => (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Account</th><th>Type</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} className={selected === a.id ? '[&>td]:!bg-accent-soft' : undefined}>
                        <td>
                          <button className="link text-left" onClick={() => { setSelected(a.id); setPage(1); }} aria-pressed={selected === a.id}>
                            <span className="num mr-1.5 text-ink-faint">{a.code}</span>{a.name}
                          </button>
                          {me?.isPlatformAdmin && <p className="text-xs text-ink-faint">{a.companyName ?? 'Platform account'}</p>}
                        </td>
                        <td><Badge>{titleCase(a.type)}</Badge><p className="mt-0.5 text-[11px] text-ink-faint">{a.normalBalance.toLowerCase()}-normal</p></td>
                        <td className="text-right"><Money value={a.balance} currency={a.currency} strong /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
        <Card title={statement.data ? `Statement — ${statement.data.account.code} ${statement.data.account.name}` : 'Statement'} className="lg:col-span-3" padded={false}>
          {!selected ? (
            <Empty title="Select an account" />
          ) : (
            <QueryState query={statement}>
              {(s) =>
                s.entries.length === 0 ? (
                  <Empty title="No entries on this account" />
                ) : (
                  <>
                    <div className="table-wrap">
                      <table className="table">
                        <thead><tr><th>When</th><th>Transaction</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance after</th></tr></thead>
                        <tbody>
                          {s.entries.map((e) => (
                            <tr key={e.id}>
                              <td className="whitespace-nowrap text-ink-muted">{formatDateTime(e.createdAt)}</td>
                              <td>
                                {titleCase(e.transaction.type)}
                                <p className="text-xs text-ink-faint">{e.transaction.paymentId ? <Link className="link" href={`/payments/${e.transaction.paymentId}`}>{e.transaction.description}</Link> : e.transaction.description}</p>
                              </td>
                              <td className="num text-right">{e.direction === 'DEBIT' ? <Money value={e.amount} currency={e.currency} /> : ''}</td>
                              <td className="num text-right">{e.direction === 'CREDIT' ? <Money value={e.amount} currency={e.currency} /> : ''}</td>
                              <td className="text-right"><Money value={e.balanceAfter} currency={e.currency} strong /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination meta={s.meta} onPage={setPage} />
                  </>
                )
              }
            </QueryState>
          )}
        </Card>
      </div>
    </>
  );
}
