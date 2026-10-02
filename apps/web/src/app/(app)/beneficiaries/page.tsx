'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Users } from 'lucide-react';
import { Card, EmptyState, PageHeader, Pagination, QueryState, StatusBadge } from '@/components/ui';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Beneficiary } from '@/lib/types';

function List() {
  const { can, me } = useAuth();
  const initial = useSearchParams().get('status') ?? '';
  const [status, setStatus] = useState(initial);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['beneficiaries', status, q, page], queryFn: () => api.page<Beneficiary>(`/beneficiaries${qs({ status, q, page, pageSize: 20 })}`) });

  return (
    <>
      <PageHeader title="Beneficiaries" description="Indian payees. Account numbers are encrypted at rest and only ever shown masked." actions={can('beneficiary.create') && <Link href="/beneficiaries/new" className="btn-primary">Add beneficiary</Link>} />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-surface-line p-3">
          <div>
            <label className="label" htmlFor="b-search">Search by name</label>
            <input id="b-search" className="input" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="e.g. Rahul" />
          </div>
          <div>
            <label className="label" htmlFor="b-status">Status</label>
            <select id="b-status" className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </div>
        </div>
        <QueryState query={query}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyState icon={Users} title="No beneficiaries found" action={can('beneficiary.create') && <Link className="btn-primary" href="/beneficiaries/new">Add beneficiary</Link>}>Beneficiaries are the Indian payees your company sends to.</EmptyState>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Bank</th>
                        <th>Account</th>
                        <th>IFSC</th>
                        <th>Status</th>
                        <th className="text-right">Payments</th>
                        <th>Added</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <Link href={`/beneficiaries/${b.id}`} className="link">{b.name}</Link>
                            {me?.isPlatformAdmin && <p className="text-xs text-ink-faint">{b.companyName}</p>}
                          </td>
                          <td>{b.bankName}</td>
                          <td className="num">{b.accountNumberMasked}</td>
                          <td className="num">{b.ifsc}</td>
                          <td><StatusBadge value={b.status} /></td>
                          <td className="num text-right">{b.paymentCount ?? 0}</td>
                          <td className="text-ink-muted">{formatDate(b.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination meta={data.meta} onPage={setPage} />
              </>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}

export default function BeneficiariesPage() {
  return (
    <Suspense>
      <List />
    </Suspense>
  );
}
