'use client';

import clsx from 'clsx';
import { ArrowRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand';

const LINKS = [
  { href: '/#how-it-works', id: 'how-it-works', label: 'How it works' },
  { href: '/#features', id: 'features', label: 'Features' },
  { href: '/#lifecycle', id: 'lifecycle', label: 'Lifecycle' },
  { href: '/#security', id: 'security', label: 'Security' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    // Highlight the section currently in view.
    const sections = LINKS.map((l) => document.getElementById(l.id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    sections.forEach((s) => observer.observe(s));
    return () => {
      window.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <header className={clsx('sticky top-0 z-40 border-b transition-colors duration-200', scrolled || open ? 'border-border bg-card/90 backdrop-blur-md' : 'border-transparent bg-background')}>
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label="PayBridge home" className="rounded-md">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.id} href={l.href} aria-current={active === l.id ? 'true' : undefined} className={clsx('relative rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200', active === l.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {l.label}
              <span aria-hidden="true" className={clsx('absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-primary transition-opacity duration-200', active === l.id ? 'opacity-100' : 'opacity-0')} />
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <Link href="/login" className="btn-ghost">Sign in</Link>
          <Link href="/login" className="btn-primary group">
            Enter sandbox <ArrowRight aria-hidden="true" className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
        <button className="btn-secondary !px-2.5 md:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}>
          {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-menu" aria-label="Primary mobile" className="border-t border-border bg-card md:hidden">
          <div className="container flex flex-col gap-1 py-3">
            {LINKS.map((l) => (
              <Link key={l.id} href={l.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 font-medium text-foreground hover:bg-muted">
                {l.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Link href="/login" className="btn-secondary">Sign in</Link>
              <Link href="/login" className="btn-primary">Enter sandbox</Link>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
