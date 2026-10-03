import { ArrowLeftRight, BookOpenCheck, Scale, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand';

const POINTS = [
  [ArrowLeftRight, 'FX', 'Locked AED → INR quotes with transparent spread and fee'],
  [ShieldCheck, 'Compliance', 'Rules, review queue and maker-checker approval'],
  [BookOpenCheck, 'Ledger', 'Double entry, append-only, balanced in every currency'],
  [Scale, 'Reconciliation', 'Payment, provider and ledger matched three ways'],
] as const;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-30px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel: a continuation of the landing page. Hidden on small screens, where the form comes first. */}
      <aside className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <Link href="/" className="relative w-fit rounded-md" aria-label="PayBridge home"><Logo tone="light" /></Link>
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Cross-border payments, built for learning.</p>
          <p className="mt-3 text-white/65">Sign in to a sandbox that runs FX pricing, compliance, a double-entry ledger, provider webhooks and reconciliation end to end — on fictional data.</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/5"><Icon aria-hidden="true" className="h-[18px] w-[18px]" /></span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-white/65">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/55">A learning project. Not a bank or a licensed payment service; it moves no money.</p>
      </aside>

      <main className="flex flex-col bg-background px-4 py-8 sm:px-8">
        <Link href="/" className="w-fit rounded-md lg:hidden" aria-label="PayBridge home"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center py-8"><div className="sm:card sm:p-8">{children}</div></div>
        <p className="text-center text-xs text-muted-foreground"><span className="font-semibold text-foreground">Educational Sandbox</span> · No real money movement. Do not enter real financial or identity data.</p>
      </main>
    </div>
  );
}
