import clsx from 'clsx';

/**
 * PayBridge mark: two piers joined by a span, with a second, lighter span behind it — a bridge between two
 * places. Drawn on a 32-unit grid with strokes that stay legible down to 16px.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="rgb(var(--primary))" />
      <path d="M7 21.5V19c0-5 4-9 9-9s9 4 9 9v2.5" stroke="white" strokeOpacity="0.38" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M7 21.5c0-4 4-6.5 9-6.5s9 2.5 9 6.5" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5 21.5h22" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28, className, tone = 'dark' }: { size?: number; className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className={clsx('font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-foreground')} style={{ fontSize: Math.round(size * 0.62) }}>
        PayBridge
      </span>
    </span>
  );
}
