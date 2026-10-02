'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Loading, StatusBadge } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { titleCase } from '@/lib/format';

/**
 * Page-level permission map. The API enforces access regardless; this stops a user from landing on a screen
 * they cannot use by typing its address. First match wins, so specific paths come first.
 */
const ROUTE_PERMISSIONS: [RegExp, string][] = [
  [/^\/payments\/new/, 'payment.create'],
  [/^\/beneficiaries\/new/, 'beneficiary.create'],
  [/^\/company\/users/, 'user.manage'],
  [/^\/admin\/companies/, 'kyb.review'],
  [/^\/admin\/compliance/, 'compliance.review'],
  [/^\/admin\/reconciliation/, 'reconciliation.read'],
  [/^\/admin\/webhooks/, 'webhook.read'],
  [/^\/admin\/audit-logs/, 'audit.read'],
  [/^\/ledger/, 'ledger.read'],
  [/^\/quotes/, 'quote.read'],
  [/^\/payments/, 'payment.read'],
  [/^\/beneficiaries/, 'beneficiary.read'],
  [/^\/dashboard/, 'payment.read'],
];

interface NavItem {
  href: string;
  label: string;
  show: boolean;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const needsCompany = Boolean(me && !me.company && !me.isPlatformAdmin);

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (needsCompany && pathname !== '/company') router.replace('/company');
  }, [loading, me, needsCompany, pathname, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !me) return <Loading label="Loading your workspace…" />;

  const admin = me.isPlatformAdmin;
  const required = ROUTE_PERMISSIONS.find(([pattern]) => pattern.test(pathname))?.[1];
  const denied = (required !== undefined && !can(required)) || (admin && pathname.startsWith('/company') && !pathname.startsWith('/company/users'));
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [{ href: '/dashboard', label: 'Dashboard', show: can('payment.read') }],
    },
    {
      title: 'Payments',
      items: [
        { href: '/payments', label: 'Payments', show: can('payment.read') },
        { href: '/payments/new', label: 'New payment', show: can('payment.create') },
        { href: '/beneficiaries', label: 'Beneficiaries', show: can('beneficiary.read') },
        { href: '/quotes', label: 'Quotes', show: can('quote.read') },
      ],
    },
    {
      title: 'Ledger',
      items: [
        { href: '/ledger', label: 'Transactions', show: can('ledger.read') },
        { href: '/ledger/accounts', label: 'Accounts', show: can('ledger.read') },
      ],
    },
    {
      title: 'Company',
      items: [
        { href: '/company', label: 'Profile', show: !admin },
        { href: '/company/kyb', label: 'KYB', show: !admin && can('kyb.read') },
        { href: '/company/users', label: 'Users', show: can('user.manage') },
      ],
    },
    {
      title: admin ? 'Operations' : 'Oversight',
      items: [
        { href: '/admin/companies', label: 'Companies & KYB', show: can('kyb.review') },
        { href: '/admin/compliance', label: 'Compliance queue', show: can('compliance.review') },
        { href: '/admin/reconciliation', label: 'Reconciliation', show: can('reconciliation.read') },
        { href: '/admin/webhooks', label: 'Webhooks & jobs', show: can('webhook.read') },
        { href: '/admin/audit-logs', label: 'Audit log', show: can('audit.read') },
      ],
    },
  ];

  const isActive = (href: string) => {
    if (href === '/payments') return pathname === '/payments' || (/^\/payments\/[^/]+$/.test(pathname) && pathname !== '/payments/new');
    if (href === '/ledger' || href === '/company') return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="flex min-h-[calc(100vh-2rem)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-10 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className={clsx('fixed inset-y-0 left-0 top-8 z-40 w-60 shrink-0 overflow-y-auto border-r border-surface-line bg-surface md:static md:block', menuOpen ? 'block' : 'hidden')}>
        <div className="border-b border-surface-line px-4 py-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-xs font-bold text-white">
              PB
            </span>
            <span className="text-base font-semibold tracking-tight">PayBridge</span>
          </Link>
          <p className="mt-1 text-xs text-ink-faint">Simulated AED → INR payments</p>
        </div>
        <nav aria-label="Main" className="px-2 py-3">
          {groups.map((group) => {
            const items = group.items.filter((i) => i.show);
            if (!items.length || needsCompany) return null;
            return (
              <div key={group.title} className="mb-4">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{group.title}</p>
                <ul>
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} aria-current={isActive(item.href) ? 'page' : undefined} className={clsx('block rounded-md px-2 py-1.5 font-medium', isActive(item.href) ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink')}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-surface-line bg-surface px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button className="btn-secondary md:hidden" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label="Toggle navigation">
              Menu
            </button>
            <div className="min-w-0">
              <p className="truncate font-semibold" data-testid="company-name">
                {admin ? 'Platform operations' : (me.company?.name ?? 'No company yet')}
              </p>
              {me.company && (
                <p className="flex items-center gap-1.5 text-xs text-ink-muted">
                  KYB <StatusBadge value={me.company.kybStatus} testId="kyb-status-header" />
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="font-medium" data-testid="user-name">{me.user.fullName}</p>
              <p className="text-xs text-ink-muted" data-testid="user-role">{me.role ? titleCase(me.role) : 'No role yet'}</p>
            </div>
            <button
              className="btn-secondary"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {needsCompany && pathname !== '/company' ? (
            <Loading />
          ) : denied ? (
            <div data-testid="access-denied">
              <Alert tone="warn" title="You do not have access to this page">
                Your role ({me.role ? titleCase(me.role) : 'none'}) does not include the permission this page needs. <Link className="link" href="/dashboard">Back to the dashboard</Link>
              </Alert>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
