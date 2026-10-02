import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { SANDBOX_LABEL } from '@paybridge/shared';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'PayBridge — Cross-border payments, built for learning', template: '%s · PayBridge Sandbox' },
  description: `${SANDBOX_LABEL}. A simulated UAE to India SME payments platform that demonstrates KYB, FX quotes, compliance, a double-entry ledger, webhooks and reconciliation.`,
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#09142b', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        {/* On every page, above everything else: this is a simulation. */}
        <div role="note" data-testid="sandbox-banner" className="flex items-center justify-center gap-2 bg-navy-900 px-4 py-1.5 text-center text-xs font-medium text-white">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
          <span>{SANDBOX_LABEL}</span>
          <span className="hidden text-white/60 sm:inline">· Mock providers, fictional data</span>
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
