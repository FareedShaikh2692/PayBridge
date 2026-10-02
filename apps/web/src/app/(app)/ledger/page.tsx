'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LedgerTransactionCard } from '@/components/ledger';
import { Alert, Card, Empty, PageHeader, Pagination, QueryState, Rows } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatAmount, titleCase } from '@/lib/format';
import type { LedgerTransaction } from '@/lib/types';

const TYPES = ['WALLET_TOPUP', 'PAYMENT_HOLD', 'PAYMENT_HOLD_RELEASE', 'PAYMENT_CAPTURE', 'PAYOUT_SETTLEMENT', 'PAYMENT_REVERSAL', 'NOSTRO_FUNDING'];
interface TrialBalance {
  balanced: boolean;
  currencies: { currency: string; debit: string; credit: string; difference: string }[];
  unbalancedTransactions: unknown[];
  cachedBalanceDrift: unknown[];
}

export default function LedgerPage() {
  const { me } = useAuth();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['ledger-tx', type, page], queryFn: () => api.page<LedgerTransaction>(`/ledger/transactions${qs({ type, page, pageSize: 10 })}`) });
  const trial = useQuery({ queryKey: ['trial-balance'], queryFn: () => api.get<TrialBalance>('/admin/ledger/trial-balance'), enabled: Boolean(me?.isPlatformAdmin) });

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every financial event is one balanced transaction. Records are append-only: corrections are made by posting a reversal, never by editing."
        actions={<Link href="/ledger/accounts" className="btn-secondary">Accounts</Link>}
      />
      {trial.data && (
        <div className="mb-6">
          <Card title="Trial balance (whole ledger)">
            <Alert tone={trial.data.balanced ? 'good' : 'bad'} title={trial.data.balanced ? 'The ledger balances' : 'The ledger does not balance'} testId="trial-balance">
              {trial.data.unbalancedTransactions.length} unbalanced transactions · {trial.data.cachedBalanceDrift.length} accounts whose cached balance differs from the sum of their entries
            </Alert>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {trial.data.currencies.map((c) => (
                <Rows key={c.currency} items={[[`${c.currency} debits`, <span key="d" className="num">{formatAmount(c.debit)}</span>], [`${c.currency} credits`, <span key="c" className="num">{formatAmount(c.credit)}</span>], ['Difference', <span key="x" className="num font-semibold">{formatAmount(c.difference)}</span>]]} />
              ))}
            </div>
          </Card>
        </div>
      )}
      <Card title="Transactions" padded={false} actions={
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-muted" htmlFor="l-type">Type</label>
          <select id="l-type" className="input !w-auto !py-1" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        </div>
      }>
        <QueryState query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title="No ledger transactions" />
            ) : (
              <>
                <div className="space-y-3 p-4" data-testid="ledger-list">{data.items.map((t) => <LedgerTransactionCard key={t.id} tx={t} />)}</div>
                <Pagination meta={data.meta} onPage={setPage} />
              </>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}
