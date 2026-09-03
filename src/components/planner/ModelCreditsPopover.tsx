'use client';

/**
 * Model credits popover: lists every third-party 3D model bundled under
 * `public/models/` with its full CC attribution (see `src/data/modelCredits.ts`,
 * mirrored by `THIRD_PARTY_NOTICES.md` in the repo root).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { MODEL_CREDITS, attributionSentence } from '@/data/modelCredits';

export interface ModelCreditsPopoverProps {
  /** 'row' = horizontal status-bar link (desktop); 'cell' = footer grid cell (mobile). */
  layout?: 'row' | 'cell';
}

export function ModelCreditsPopover({ layout = 'row' }: ModelCreditsPopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes; clicking anywhere outside the popover closes it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const buttonClassName =
    layout === 'cell'
      ? 'inline-flex min-h-15 w-full flex-col items-center justify-center gap-0.5 text-text-muted'
      : 'inline-flex min-h-8 items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text motion-reduce:transition-none';

  return (
    <span className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={buttonClassName}
      >
        <Info className={`shrink-0 text-accent ${layout === 'cell' ? 'size-4' : 'size-3.5'}`} aria-hidden="true" />
        <span className={layout === 'cell' ? 'text-xs' : undefined}>Model credits</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="absolute right-0 bottom-full z-40 mb-2 w-96 max-w-[calc(100vw-2rem)] rounded-control border border-border bg-surface-raised p-4 shadow-card"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight text-text">3D model credits</h3>
            <button
              type="button"
              aria-label="Close model credits"
              onClick={() => setOpen(false)}
              className="inline-flex size-8 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-muted hover:text-text motion-reduce:transition-none"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Bundled third-party models, each with its license and source. See the repo&apos;s THIRD_PARTY_NOTICES.md for the full record.
          </p>
          <ul className="mt-3 space-y-3">
            {MODEL_CREDITS.map((credit) => (
              <li key={credit.modelUri} className="text-xs leading-5 text-text">
                {attributionSentence(credit)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}
