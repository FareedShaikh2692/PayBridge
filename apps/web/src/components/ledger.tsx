'use client';

import Link from 'next/link';
import { formatAmount, formatDateTime, titleCase } from '@/lib/format';
import type { LedgerTransaction } from '@/lib/types';
import { Badge } from './ui';

/** One ledger transaction as a journal: debits left, credits right, with per-currency totals and a balance check. */
export function LedgerTransactionCard({ tx, showPayment = true }: { tx: LedgerTransaction; showPayment?: boolean }) {
  return (
    <article className="rounded-md border border-surface-line" data-testid="ledger-transaction" data-type={tx.type}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-line bg-surface-sunken px-3 py-2">
        <div>
          <p className="font-semibold">{titleCase(tx.type)}</p>
          <p className="text-xs text-ink-muted">
            {tx.description}
            {showPayment && tx.paymentId && (
              <>
                {' · '}
                <Link className="link" href={`/payments/${tx.paymentId}`}>{tx.paymentReference ?? 'payment'}</Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <time dateTime={tx.createdAt}>{formatDateTime(tx.createdAt)}</time>
          <Badge tone={tx.balanced ? 'good' : 'bad'}>{tx.balanced ? 'Balanced' : 'Unbalanced'}</Badge>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr><th>Account</th><th>Debit</th><th>Credit</th></tr>
        </thead>
        <tbody>
          {tx.entries.map((e) => (
            <tr key={e.id} className="border-b border-surface-line last:border-0">
              <td className={`px-3 py-1.5 ${e.direction === 'CREDIT' ? 'pl-8' : ''}`}>
                <span className="num mr-2 text-xs text-ink-faint">{e.accountCode}</span>
                {e.accountName}
              </td>
              <td className="num w-40 px-3 py-1.5 text-right">{e.direction === 'DEBIT' ? `${e.currency} ${formatAmount(e.amount)}` : ''}</td>
              <td className="num w-40 px-3 py-1.5 text-right">{e.direction === 'CREDIT' ? `${e.currency} ${formatAmount(e.amount)}` : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {Object.entries(tx.totals).map(([ccy, t]) => (
            <tr key={ccy} className="bg-surface-sunken text-xs font-semibold">
              <td className="px-3 py-1.5 text-ink-muted">Total {ccy}</td>
              <td className="num px-3 py-1.5 text-right">{formatAmount(t.debit)}</td>
              <td className="num px-3 py-1.5 text-right">{formatAmount(t.credit)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </article>
  );
}
