'use client';

import { PlayCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '@/components/brand';

/**
 * "Watch Product Demo": a recording of the real sandbox (fictional data), with captions and the
 * PayBridge mark as a watermark. Loads nothing until opened.
 */
export function ProductDemoButton({ className = 'btn-secondary btn-lg' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const close = () => {
    video.current?.pause();
    setOpen(false);
  };

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-testid="watch-demo">
        <PlayCircle aria-hidden="true" className="h-4 w-4" /> Watch Product Demo
      </button>
      <dialog
        ref={dialog}
        onClose={close}
        onClick={(e) => e.target === dialog.current && close()}
        aria-labelledby="demo-video-title"
        className="w-[min(960px,calc(100vw-32px))] max-w-none overflow-hidden rounded-xl bg-navy-900 p-0 text-white shadow-overlay backdrop:bg-navy-900/70 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <p id="demo-video-title" className="flex items-center gap-2 text-sm font-semibold">
            PayBridge product demo <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white/70">Sandbox · fictional data</span>
          </p>
          <button type="button" onClick={close} className="grid h-9 w-9 place-items-center rounded-md text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50" aria-label="Close demo video">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {open && (
          <div className="relative aspect-video bg-black">
            <video ref={video} className="h-full w-full" controls autoPlay playsInline preload="metadata" poster="/demo/paybridge-demo-poster.jpg">
              <source src="/demo/paybridge-demo.webm" type="video/webm" />
              <source src="/demo/paybridge-demo.mp4" type="video/mp4" />
              <track kind="captions" src="/demo/paybridge-demo.vtt" srcLang="en" label="English" />
              Your browser cannot play this video.
            </video>
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold text-white/80 backdrop-blur-sm">
              <LogoMark size={16} /> PayBridge
            </span>
          </div>
        )}
        <p className="px-4 py-3 text-xs text-white/60">A walkthrough of the educational sandbox: sign in, quote, create, approve, settle and reconcile a payment. No real money moves.</p>
      </dialog>
    </>
  );
}
