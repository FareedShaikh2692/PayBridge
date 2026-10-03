'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeftRight, BookOpenCheck, Building2, FileClock, FileSearch, LayoutDashboard, ListTree, LogOut, Menu, MoreHorizontal, Plus, Scale, Send, Settings, ShieldCheck, UserCog, Users, Webhook, X, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand';
import { Alert, Button, PageLoader, StatusBadge } from '@/components/ui';
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
  icon: LucideIcon;
  show: boolean;
}

/** Live check of the sandbox API: the indicator at the foot of the sidebar. */
function EnvironmentStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health/ready');
      const json = await res.json().catch(() => null);
      return (json?.data?.status as string) ?? (res.ok ? 'ok' : 'unavailable');
    },
    refetchInterval: 30_000,
    retry: false,
  });
  const state = health.isLoading ? 'checking' : health.error ? 'unavailable' : health.data;
  const label = state === 'ok' ? 'Connected' : state === 'degraded' ? 'Degraded' : state === 'checking' ? 'Checking…' : 'Unavailable';
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5" data-testid="environment-status" data-state={state}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sandbox environment</p>
      <p className="mt-1 flex items-center gap-2 text-[13px] font-medium">
        <span aria-hidden="true" className={clsx('relative flex h-2 w-2')}>
          {state === 'ok' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-bright opacity-40" />}
          <span className={clsx('relative inline-flex h-2 w-2 rounded-full', state === 'ok' ? 'bg-success-bright' : state === 'degraded' ? 'bg-warning-bright' : state === 'checking' ? 'bg-ink-faint' : 'bg-error-bright')} />
        </span>
        {label}
      </p>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, loading, logout, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const needsCompany = Boolean(me && !me.company && !me.isPlatformAdmin);

  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (needsCompany && pathname !== '/company') router.replace('/company');
  }, [loading, me, needsCompany, pathname, router]);

  useEffect(() => setMenuOpen(false), [pathname]);

  if (loading || !me) return <PageLoader label="Loading your workspace" />;

  const admin = me.isPlatformAdmin;
  const required = ROUTE_PERMISSIONS.find(([pattern]) => pattern.test(pathname))?.[1];
  const denied = (required !== undefined && !can(required)) || (admin && pathname.startsWith('/company') && !pathname.startsWith('/company/users'));

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Workspace',
      items: [
        { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, show: can('payment.read') },
        { href: '/payments', label: 'Payments', icon: Send, show: can('payment.read') },
        { href: '/beneficiaries', label: 'Beneficiaries', icon: Users, show: can('beneficiary.read') },
        { href: '/quotes', label: 'FX Quotes', icon: ArrowLeftRight, show: can('quote.read') },
      ],
    },
    {
      title: 'Operations',
      items: [
        { href: '/admin/compliance', label: 'Compliance', icon: ShieldCheck, show: can('compliance.review') },
        { href: '/ledger', label: 'Ledger', icon: BookOpenCheck, show: can('ledger.read') },
        { href: '/ledger/accounts', label: 'Ledger accounts', icon: ListTree, show: can('ledger.read') },
        { href: '/admin/webhooks', label: 'Webhooks', icon: Webhook, show: can('webhook.read') },
        { href: '/admin/reconciliation', label: 'Reconciliation', icon: Scale, show: can('reconciliation.read') },
        { href: '/admin/audit-logs', label: 'Audit Logs', icon: FileClock, show: can('audit.read') },
        { href: '/admin/companies', label: 'Companies & KYB', icon: Building2, show: can('kyb.review') },
      ],
    },
    {
      title: 'Company',
      items: [
        { href: '/company', label: 'Company profile', icon: Building2, show: !admin },
        { href: '/company/kyb', label: 'KYB', icon: FileSearch, show: !admin && can('kyb.read') },
        { href: '/company/users', label: 'Users', icon: UserCog, show: can('user.manage') },
        { href: '/settings', label: 'Settings', icon: Settings, show: true },
      ],
    },
  ];

  const isActive = (href: string) => {
    if (href === '/payments') return pathname === '/payments' || (/^\/payments\/[^/]+$/.test(pathname) && pathname !== '/payments/new');
    if (href === '/ledger' || href === '/company') return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  };
  const initials = me.user.fullName.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

  // Mobile: the four most-used destinations sit in a bottom bar; everything else lives behind "More".
  const bottom: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, show: can('payment.read') },
    { href: '/payments', label: 'Payments', icon: Send, show: can('payment.read') },
    { href: '/payments/new', label: 'New', icon: Plus, show: can('payment.create') },
    admin ? { href: '/admin/compliance', label: 'Compliance', icon: ShieldCheck, show: true } : { href: '/beneficiaries', label: 'Payees', icon: Users, show: can('beneficiary.read') },
  ].filter((i) => i.show);

  return (
    <div className="flex min-h-[calc(100vh-30px)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-10 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow-raised">Skip to content</a>
      {menuOpen && <button aria-label="Close navigation" className="fixed inset-0 z-40 bg-navy-900/40 backdrop-blur-[1px] md:hidden" onClick={() => setMenuOpen(false)} />}

      <aside className={clsx('fixed inset-y-0 left-0 z-50 flex w-[264px] shrink-0 flex-col border-r border-border bg-card transition-transform duration-200 md:sticky md:top-0 md:z-30 md:h-[calc(100vh-30px)] md:translate-x-0', menuOpen ? 'translate-x-0 shadow-overlay' : '-translate-x-full')}>
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/dashboard" className="rounded-md" aria-label="PayBridge overview"><Logo size={26} /></Link>
          <button className="btn-ghost !min-h-8 !px-2 text-muted-foreground md:hidden" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group) => {
            const items = group.items.filter((i) => i.show);
            if (!items.length || (needsCompany && group.title !== 'Company')) return null;
            return (
              <div key={group.title} className="mb-5">
                <p className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{group.title}</p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link href={item.href} aria-current={active ? 'page' : undefined} className={clsx('group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors duration-150', active ? 'bg-primary-soft text-primary-hover' : 'text-muted-foreground hover:bg-background hover:text-foreground')}>
                          {active && <span aria-hidden="true" className="absolute -left-3 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r-full bg-primary" />}
                          <item.icon aria-hidden="true" className={clsx('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-ink-faint group-hover:text-muted-foreground')} />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-border p-3">
          <EnvironmentStatus />
          <div className="flex items-center gap-3 px-1">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium" data-testid="user-name">{me.user.fullName}</p>
              <p className="truncate text-xs text-muted-foreground" data-testid="user-role">{me.role ? titleCase(me.role) : 'No role yet'}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[72px] md:pb-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button className="btn-secondary !px-2.5 md:hidden" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-label="Open navigation"><Menu aria-hidden="true" className="h-5 w-5" /></button>
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-semibold" data-testid="company-name">
                {admin ? 'Platform operations' : (me.company?.name ?? 'No company yet')}
                <span className="hidden rounded-md border border-warning-bright/30 bg-warning-soft px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-warning sm:inline">Sandbox</span>
              </p>
              {me.company && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">KYB <StatusBadge value={me.company.kybStatus} testId="kyb-status-header" /></p>
              )}
            </div>
          </div>
          <Button
            variant="secondary" icon={LogOut} loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await logout();
              router.replace('/login');
            }}
          >
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 md:px-8 md:py-8">
          {needsCompany && pathname !== '/company' ? (
            <PageLoader />
          ) : denied ? (
            <div data-testid="access-denied">
              <Alert tone="warn" title="You do not have access to this page">
                Your role ({me.role ? titleCase(me.role) : 'none'}) does not include the permission this page needs. <Link className="link" href="/dashboard">Back to the overview</Link>
              </Alert>
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      {!needsCompany && (
        <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
          {bottom.map((item) => {
            const active = isActive(item.href);
            const primary = item.href === '/payments/new';
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={clsx('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
                <span className={clsx('flex items-center justify-center', primary ? 'h-8 w-8 rounded-full bg-primary text-white shadow-raised' : '')}>
                  <item.icon aria-hidden="true" className="h-5 w-5" />
                </span>
                {item.label}
              </Link>
            );
          })}
          <button onClick={() => setMenuOpen(true)} className="flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground" aria-label="More navigation">
            <MoreHorizontal aria-hidden="true" className="h-5 w-5" />
            More
          </button>
        </nav>
      )}
    </div>
  );
}
