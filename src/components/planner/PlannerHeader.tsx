'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  BadgeDollarSign,
  Camera,
  CheckCircle2,
  Orbit,
  PanelLeft,
  PanelTop,
  TriangleAlert,
} from 'lucide-react';
import type { CameraMode } from '@/domain/types';
import { selectTotals, selectValidationValid } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';

const cameras: readonly { mode: CameraMode; label: string; Icon: typeof Camera }[] = [
  { mode: 'orbit', label: 'Orbit', Icon: Orbit },
  { mode: 'top', label: 'Top', Icon: ArrowUp },
  { mode: 'front', label: 'Front', Icon: PanelTop },
  { mode: 'side', label: 'Side', Icon: PanelLeft },
];

const activityFeedback = {
  room_inspected: 'Agent reviewed the room.',
  products_searched: 'Agent reviewed marketplace options.',
  layout_checked: 'Agent checked the layout.',
  total_calculated: 'Agent recalculated marketplace spend.',
  alternatives_found: 'Agent reviewed lower-cost alternatives.',
  item_added: 'Agent added an item.',
  item_moved: 'Agent moved an item.',
  item_rotated: 'Agent rotated an item.',
  item_removed: 'Agent removed an item.',
  item_replaced: 'Agent replaced an item.',
  item_locked: 'Agent locked an item.',
  item_unlocked: 'Agent unlocked an item.',
  design_saved: 'Agent saved the design.',
  design_restored: 'Agent restored the design.',
  cart_item_added: 'Agent added an item to the cart.',
  checkout_completed: 'Agent completed checkout.',
  budget_updated: 'Agent updated the budget.',
} as const;

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function PlannerHeader() {
  const totals = useRoomStore(selectTotals);
  const valid = useRoomStore(selectValidationValid);
  const activity = useRoomStore((state) => state.activity);
  const lastMutation = useRoomStore((state) => state.lastMutation);
  const cameraMode = useRoomStore((state) => state.cameraMode);
  const setCameraMode = useRoomStore((state) => state.setCameraMode);
  const setBudget = useRoomStore((state) => state.setBudget);
  const [budgetInput, setBudgetInput] = useState(String(totals.budget));
  const [message, setMessage] = useState('');
  const [feedbackMutation, setFeedbackMutation] = useState<number | null>(null);
  const [feedbackActive, setFeedbackActive] = useState(false);
  const previousMutation = useRef(lastMutation);
  const previousActivityId = useRef(activity.at(-1)?.id);

  useEffect(() => {
    setBudgetInput(String(totals.budget));
  }, [totals.budget]);

  useEffect(() => {
    if (lastMutation === previousMutation.current) {
      return;
    }

    const latestActivity = activity.at(-1);
    const hasNewActivity = latestActivity?.id !== previousActivityId.current;

    previousMutation.current = lastMutation;
    previousActivityId.current = latestActivity?.id;
    setFeedbackMutation(lastMutation);
    setFeedbackActive(true);
    setMessage(
      hasNewActivity && latestActivity !== undefined
        ? `${activityFeedback[latestActivity.type]} Budget and layout status refreshed.`
        : 'Budget and layout status refreshed.',
    );

    const timer = setTimeout(() => setFeedbackActive(false), 240);
    return () => clearTimeout(timer);
  }, [activity, lastMutation]);

  function applyBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = Number(budgetInput);
    const result = setBudget(budget, 'human');
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setBudgetInput(String(result.data.budget));
    setMessage(`Budget applied: ${money(result.data.budget)}.`);
  }

  const budgetTone = totals.overBudget
    ? 'bg-error-soft text-error'
    : 'bg-success-soft text-success';
  const budgetLabel = totals.overBudget
    ? `${money(Math.abs(totals.remaining))} over budget`
    : `${money(totals.remaining)} remaining`;

  const feedbackClass = feedbackActive
    ? 'bg-accent-soft motion-safe:animate-[pulse_240ms_ease-out_1] motion-reduce:animate-none'
    : '';

  return (
    <header className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-[var(--shadow-card)]">
      <div className="flex flex-col gap-5 px-4 py-4 sm:px-5 sm:py-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-accent-strong uppercase">
            Hearth & Form
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-text sm:text-subheading">Living room planner</h1>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
            <p className="text-sm text-text-muted">Shape a room that feels considered, before it comes home.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-3 xl:justify-end">
          <section aria-label="Design budget" className="w-full rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 py-3 shadow-[var(--shadow-card)] sm:w-80">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-xs font-semibold tracking-wider text-text-muted uppercase">Marketplace spend</p>
              <p
                key={`marketplace-spend-${feedbackMutation ?? 'initial'}`}
                className={`rounded-control px-1 font-mono text-sm font-semibold tabular-nums text-text ${feedbackClass}`}
              >
                {money(totals.newTotal)} <span className="text-text-faint">/</span> {money(totals.budget)}
              </p>
            </div>
            <p
              key={`budget-remaining-${feedbackMutation ?? 'initial'}`}
              className={`mt-1 inline-flex rounded-pill px-2 py-0.5 text-xs font-semibold ${budgetTone} ${feedbackActive ? 'ring-1 ring-accent motion-safe:animate-[pulse_240ms_ease-out_1] motion-reduce:animate-none' : ''}`}
            >
              {budgetLabel}
            </p>
            <form className="mt-3 flex gap-2" onSubmit={applyBudget}>
              <label className="sr-only" htmlFor="planner-budget">Budget in US dollars</label>
              <div className="flex min-w-0 flex-1 items-center rounded-control border border-border bg-surface-muted px-2">
                <BadgeDollarSign className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
                <input
                  id="planner-budget"
                  className="min-h-11 w-full bg-transparent px-1 text-sm font-medium tabular-nums text-text outline-none"
                  inputMode="decimal"
                  min="0"
                  step="50"
                  type="number"
                  value={budgetInput}
                  onChange={(event) => setBudgetInput(event.target.value)}
                />
              </div>
              <button type="submit" className="min-h-11 rounded-[var(--radius-control)] bg-accent px-3 text-sm font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-strong motion-reduce:transition-none">
                Apply
              </button>
            </form>
          </section>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-none sm:flex-nowrap">
            <div
              key={`layout-validation-${feedbackMutation ?? 'initial'}`}
              className={`inline-flex min-h-11 items-center gap-2 rounded-pill px-3 text-sm font-medium ${valid ? 'bg-success-soft text-success' : 'bg-error-soft text-error'} ${feedbackActive ? 'ring-1 ring-accent motion-safe:animate-[pulse_240ms_ease-out_1] motion-reduce:animate-none' : ''}`}
            >
              {valid ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <TriangleAlert className="size-4" aria-hidden="true" />}
              {valid ? 'Layout valid' : 'Review layout'}
            </div>
            <div className="flex shrink-0 rounded-[var(--radius-control)] border border-border bg-surface-raised p-1 shadow-[var(--shadow-card)]" aria-label="Room camera">
              {cameras.map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={cameraMode === mode}
                  onClick={() => setCameraMode(mode)}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs font-semibold transition-colors duration-200 motion-reduce:transition-none ${cameraMode === mode ? 'bg-accent text-on-accent shadow-[var(--shadow-card)]' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <p role="status" aria-live="polite" className="border-t border-border px-4 py-2 text-sm text-text-muted sm:px-5">
        {message}
      </p>
    </header>
  );
}
