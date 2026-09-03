'use client';

import { CheckCircle2, PackageSearch, PencilRuler, Sparkles, TriangleAlert } from 'lucide-react';
import { selectTotals, selectValidationValid } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';
import { ModelCreditsPopover } from '@/components/planner/ModelCreditsPopover';

export type SidebarMode = 'catalog' | 'edit';

interface WorkspaceStatusBarProps {
  sidebarMode: SidebarMode;
  onOpenActivity: () => void;
  onOpenSidebar: (mode: SidebarMode) => void;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Persistent summary and mobile entry points without another dashboard row. */
export function WorkspaceStatusBar({
  sidebarMode,
  onOpenActivity,
  onOpenSidebar,
}: WorkspaceStatusBarProps) {
  const totals = useRoomStore(selectTotals);
  const valid = useRoomStore(selectValidationValid);
  const furnitureCount = useRoomStore((state) => state.furniture.length);
  const activity = useRoomStore((state) => state.activity);
  const latestActivity = activity.at(-1);

  return (
    <footer className="relative z-30 shrink-0 border-t border-border bg-surface text-xs text-text-muted">
      <div className="hidden h-12 items-center justify-between gap-6 px-5 lg:flex lg:pl-80">
        <div className="flex min-w-0 items-center gap-5">
          <span className={`inline-flex items-center gap-1.5 font-semibold ${valid ? 'text-success' : 'text-error'}`}>
            {valid ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <TriangleAlert className="size-4" aria-hidden="true" />}
            {valid ? 'Layout valid' : 'Review layout'}
          </span>
          <span>{furnitureCount} {furnitureCount === 1 ? 'piece' : 'pieces'}</span>
          <span className="tabular-nums">Marketplace spend · {money.format(totals.newTotal)}</span>
          <span className={`font-semibold tabular-nums ${totals.overBudget ? 'text-error' : 'text-success'}`}>
            {totals.overBudget
              ? `${money.format(Math.abs(totals.remaining))} over`
              : `${money.format(totals.remaining)} left`}
          </span>
        </div>
        <ModelCreditsPopover />
        <button
          type="button"
          onClick={onOpenActivity}
          className="inline-flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 transition-colors hover:bg-surface-muted hover:text-text motion-reduce:transition-none"
        >
          <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="max-w-64 truncate">
            {latestActivity?.message ?? 'Agent activity'}
          </span>
          {activity.length > 0 ? <span className="font-semibold text-accent-strong">{activity.length}</span> : null}
        </button>
      </div>

      <div className="grid h-15 grid-cols-4 lg:hidden">
        <button
          type="button"
          onClick={() => onOpenSidebar('catalog')}
          aria-pressed={sidebarMode === 'catalog'}
          className={`inline-flex flex-col items-center justify-center gap-0.5 ${sidebarMode === 'catalog' ? 'text-accent' : 'text-text-muted'}`}
        >
          <PackageSearch className="size-4" aria-hidden="true" />
          Furnish
        </button>
        <button
          type="button"
          onClick={() => onOpenSidebar('edit')}
          aria-pressed={sidebarMode === 'edit'}
          aria-label={`Edit ${valid ? 'layout valid' : 'layout needs review'}`}
          className={`inline-flex flex-col items-center justify-center gap-0.5 ${sidebarMode === 'edit' ? 'text-accent' : 'text-text-muted'}`}
        >
          <span className="relative" aria-hidden="true">
            <PencilRuler className="size-4" />
            <span
              className={`absolute -top-1 -right-1.5 size-2 rounded-pill ring-2 ring-surface ${valid ? 'bg-success' : 'bg-error'}`}
            />
          </span>
          Edit
        </button>
        <button
          type="button"
          onClick={onOpenActivity}
          className="inline-flex flex-col items-center justify-center gap-0.5 text-text-muted"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Activity{activity.length > 0 ? ` · ${activity.length}` : ''}
        </button>
        <ModelCreditsPopover layout="cell" />
      </div>
    </footer>
  );
}
