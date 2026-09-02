'use client';

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Eye,
  LockKeyhole,
  PackageCheck,
  Search,
  ShoppingBag,
  Sparkles,
  Undo2,
  UnlockKeyhole,
} from 'lucide-react';

import type { ActivityType } from '@/domain/types';
import { useRoomStore } from '@/store/roomStore';

const VISIBLE_ACTIVITY_COUNT = 6;

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const MONEY_ACTIVITY_TYPES: Partial<Record<ActivityType, true>> = {
  total_calculated: true,
  alternatives_found: true,
  item_added: true,
  item_replaced: true,
  budget_updated: true,
};

const activityIcons: Record<ActivityType, LucideIcon> = {
  room_inspected: Eye,
  products_searched: Search,
  layout_checked: ClipboardCheck,
  total_calculated: Calculator,
  alternatives_found: Sparkles,
  item_added: PackageCheck,
  item_moved: ArrowLeftRight,
  item_rotated: ArrowLeftRight,
  item_removed: Undo2,
  item_replaced: ArrowLeftRight,
  item_locked: LockKeyhole,
  item_unlocked: UnlockKeyhole,
  design_saved: CheckCircle2,
  design_restored: Undo2,
  cart_item_added: ShoppingBag,
  checkout_completed: CheckCircle2,
  budget_updated: CircleDollarSign,
};


/** Recent, application-generated actions completed by an external agent. */
export function AgentActivityFeed() {
  const activity = useRoomStore((state) => state.activity);
  const entries = activity.slice(-VISIBLE_ACTIVITY_COUNT).reverse();

  return (
    <aside
      className="flex min-h-0 flex-col overflow-hidden rounded-card border bg-surface shadow-card"
      aria-labelledby="agent-activity-title"
    >
      <div className="border-b bg-surface-raised px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
            <h2 id="agent-activity-title" className="font-semibold tracking-tight text-text">
              Agent activity
            </h2>
          </div>
          {activity.length > 0 ? (
            <span className="rounded-pill bg-accent-soft px-2 py-1 text-xs font-semibold tabular-nums text-accent-strong">
              {activity.length} recorded
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-small text-text-muted">
          Completed external-agent actions, kept separate from your room edits.
        </p>
      </div>

      <ol
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-relevant="additions text"
        aria-label="Recent external-agent actions"
      >
        {entries.length === 0 ? (
          <li className="flex min-h-36 items-center px-4 py-5 sm:px-5">
            <p className="rounded-control bg-surface-muted px-3 py-3 text-small leading-6 text-text-muted">
              Ask an external agent to check the room or save a plan. Its completed actions will appear here.
            </p>
          </li>
        ) : (
          entries.map((entry, index) => {
            const Icon = activityIcons[entry.type];
            const amount =
              MONEY_ACTIVITY_TYPES[entry.type] &&
              entry.amount !== undefined &&
              Number.isFinite(entry.amount)
                ? currency.format(entry.amount)
                : null;
            const isNewest = index === 0;

            return (
              <li
                key={entry.id}
                className={`flex items-start gap-3 px-4 py-3 transition-[background-color,opacity,transform] duration-200 ease-out hover:-translate-y-px motion-reduce:transform-none motion-reduce:transition-none sm:px-5 ${
                  isNewest ? 'bg-accent-soft/45 hover:bg-accent-soft' : 'bg-surface hover:bg-surface-muted'
                }`}
              >
                <span
                  className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill ${
                    isNewest ? 'bg-accent-soft text-accent-strong' : 'bg-surface-muted text-text-muted'
                  }`}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-small leading-5 text-text">{entry.message}</span>
                    {isNewest ? (
                      <span className="shrink-0 rounded-pill bg-surface-raised px-2 py-0.5 text-xs font-semibold tracking-wider text-accent-strong uppercase">
                        Latest
                      </span>
                    ) : null}
                  </span>
                  {amount ? <span className="mt-1 block text-xs font-semibold tabular-nums text-text-muted">{amount}</span> : null}
                </span>
              </li>
            );
          })
        )}
      </ol>
    </aside>
  );
}
