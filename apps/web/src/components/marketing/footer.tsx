import { SANDBOX_LABEL } from '@paybridge/shared';
import Link from 'next/link';
import { Logo } from '@/components/brand';

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  { title: 'Product', links: [{ href: '/#how-it-works', label: 'How it works' }, { href: '/#features', label: 'Features' }, { href: '/#security', label: 'Security' }] },
  { title: 'Resources', links: [{ href: '/docs', label: 'Documentation' }, { href: '/api/docs', label: 'API reference' }, { href: '/docs#architecture', label: 'Architecture' }] },
  { title: 'Legal', links: [{ href: '/legal#educational-use', label: 'Educational use' }, { href: '/legal#privacy', label: 'Privacy' }, { href: '/legal#terms', label: 'Terms' }] },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="container grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)] md:py-16">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-muted-foreground">A cross-border payment engineering sandbox. Built to show how the pieces of a payment platform fit together.</p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{col.title}</p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="text-muted-foreground transition-colors duration-200 hover:text-primary">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="container flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 PayBridge. A learning project, not a financial service.</p>
          <p className="font-medium text-foreground">{SANDBOX_LABEL}</p>
        </div>
      </div>
    </footer>
  );
}
