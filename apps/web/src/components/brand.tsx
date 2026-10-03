import clsx from 'clsx';

/**
 * PayBridge mark: the letter P whose bowl continues as a bridge span to a second pier, with a point travelling
 * along it — P → bridge → currency flow (AED → INR). Geometric strokes on a 32-unit grid, legible from 16px.
 */
export function LogoMark({ size = 32, className, flow = false }: { size?: number; className?: string; flow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="8" fill="rgb(var(--navy-900))" />
      {/* P: stem (first pier) and bowl */}
      <path d="M9.5 24V8.5h5.75a4.75 4.75 0 0 1 0 9.5H9.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {/* Span from the bowl to the second pier */}
      <path d="M15.25 18c3.9 0 6.6 1.9 7.25 6" stroke="rgb(96 165 250)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="22.75" cy="24" r="1.9" fill="rgb(96 165 250)" />
      {flow && (
        <circle r="1.4" fill="white">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M15.25 18c3.9 0 6.6 1.9 7.25 6" />
        </circle>
      )}
    </svg>
  );
}

export function Logo({ size = 28, className, tone = 'dark' }: { size?: number; className?: string; tone?: 'dark' | 'light' }) {
  return (
    <span className={clsx('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <span className={clsx('font-semibold tracking-[-0.02em]', tone === 'light' ? 'text-white' : 'text-foreground')} style={{ fontSize: Math.round(size * 0.64) }}>
        PayBridge
      </span>
    </span>
  );
}
