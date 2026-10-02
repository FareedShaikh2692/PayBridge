import type { Metadata } from 'next';
import { SANDBOX_LABEL } from '@paybridge/shared';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'PayBridge — Sandbox', template: '%s · PayBridge Sandbox' },
  description: `${SANDBOX_LABEL}. A simulated UAE to India SME payments platform for learning.`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        {/* Shown on every page, above everything else: this is a simulation. */}
        <div role="note" data-testid="sandbox-banner" className="sticky top-0 z-50 border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-center text-xs font-semibold text-warn">
          {SANDBOX_LABEL}
          <span className="ml-2 hidden font-normal sm:inline">All providers are mocks and all data is fictional.</span>
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
