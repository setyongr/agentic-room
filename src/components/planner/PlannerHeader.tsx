'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  BadgeDollarSign,
  Camera,
  FolderOpen,
  Orbit,
  PanelLeft,
  PanelTop,
  Save,
  ShoppingBag,
  X,
} from 'lucide-react';
import type { CameraMode } from '@/domain/types';
import { APP_NAME, APP_TAGLINE } from '@/data/appIdentity';
import { selectCartCount, selectTotals } from '@/store/selectors';
import { useRoomStore } from '@/store/roomStore';

const cameras: readonly { mode: CameraMode; label: string; Icon: typeof Camera }[] = [
  { mode: 'orbit', label: 'Orbit', Icon: Orbit },
  { mode: 'top', label: 'Top', Icon: ArrowUp },
  { mode: 'front', label: 'Front', Icon: PanelTop },
  { mode: 'side', label: 'Side', Icon: PanelLeft },
];

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

interface PlannerHeaderProps {
  onOpenCart: () => void;
  onOpenDesigns: () => void;
}

/** Compact navigation and design actions for the workspace. */
export function PlannerHeader({ onOpenCart, onOpenDesigns }: PlannerHeaderProps) {
  const totals = useRoomStore(selectTotals);
  const cartCount = useRoomStore(selectCartCount);
  const setBudget = useRoomStore((state) => state.setBudget);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetMessage, setBudgetMessage] = useState('');
  const budgetDialogId = useId();
  const budgetInputRef = useRef<HTMLInputElement>(null);
  const budgetTriggerRef = useRef<HTMLButtonElement>(null);
  const budgetDialogRef = useRef<HTMLDivElement>(null);

  function closeBudget() {
    setBudgetOpen(false);
    budgetTriggerRef.current?.focus();
  }

  function openBudget() {
    setBudgetInput(String(totals.budget));
    setBudgetMessage('');
    setBudgetOpen(true);
  }

  useEffect(() => {
    if (!budgetOpen) return;

    budgetInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeBudget();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = budgetDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable === undefined || focusable.length === 0) return;

      const first = focusable.item(0);
      const last = focusable.item(focusable.length - 1);
      if (first === null || last === null) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [budgetOpen]);

  function applyBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = Number(budgetInput);
    if (budgetInput.trim() === '' || !Number.isFinite(budget) || budget < 0) {
      setBudgetMessage('Enter a non-negative budget.');
      return;
    }

    const result = setBudget(budget, 'human');
    setBudgetMessage(result.ok ? 'Budget updated.' : result.message);
  }

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface px-3 sm:px-5">
        <h1 className="sr-only">{APP_NAME} — Living room planner</h1>
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-text">{APP_NAME}</p>
            <p className="hidden text-xs text-text-muted sm:block">{APP_TAGLINE}</p>
          </div>
          <span className="hidden h-5 w-px bg-border md:block" aria-hidden="true" />
          <nav aria-label="Planner actions" className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenDesigns}
              aria-label="Open designs"
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            >
              <FolderOpen className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Designs</span>
            </button>
            <button
              type="button"
              onClick={onOpenCart}
              aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
            >
              <ShoppingBag className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Cart</span>
              <span className="min-w-4 rounded-control bg-surface-muted px-1 text-center text-xs font-semibold tabular-nums text-text" aria-hidden="true">{cartCount}</span>
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            ref={budgetTriggerRef}
            type="button"
            onClick={openBudget}
            aria-expanded={budgetOpen}
            aria-controls={budgetOpen ? budgetDialogId : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold tabular-nums transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${totals.overBudget ? 'text-error' : 'text-text'}`}
            aria-label={`Marketplace spend ${money.format(totals.newTotal)} of ${money.format(totals.budget)}. Edit budget.`}
          >
            <BadgeDollarSign className="size-4" aria-hidden="true" />
            <span className="hidden lg:inline">{money.format(totals.newTotal)} / {money.format(totals.budget)}</span>
            <span className="lg:hidden">{money.format(totals.newTotal)}</span>
          </button>
          <button
            type="button"
            onClick={onOpenDesigns}
            className="inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong motion-reduce:transition-none"
          >
            <Save className="size-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Save design</span>
          </button>
        </div>
      </header>

      {budgetOpen ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default"
            aria-label="Close budget editor"
            onClick={closeBudget}
          />
          <div
            ref={budgetDialogRef}
            id={budgetDialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${budgetDialogId}-title`}
            className="absolute inset-x-3 top-20 rounded-control border border-border bg-surface p-4 shadow-pop sm:inset-x-auto sm:right-5 sm:w-80"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={`${budgetDialogId}-title`} className="text-sm font-semibold text-text">Edit budget</h2>
              <button
                type="button"
                onClick={closeBudget}
                className="inline-flex size-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-muted hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                aria-label="Close budget editor"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            <form className="mt-4 space-y-3" noValidate onSubmit={applyBudget}>
              <label className="block space-y-1.5 text-sm font-medium text-text" htmlFor={`${budgetDialogId}-input`}>
                Budget
                <input
                  ref={budgetInputRef}
                  id={`${budgetDialogId}-input`}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={budgetInput}
                  onChange={(event) => setBudgetInput(event.target.value)}
                  className="block min-h-11 w-full rounded-control border border-border bg-surface px-3 text-sm tabular-nums text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
                />
              </label>
              <p className={`text-sm font-medium tabular-nums ${totals.overBudget ? 'text-error' : 'text-text-muted'}`}>
                {totals.overBudget
                  ? `${money.format(Math.abs(totals.remaining))} over budget`
                  : `${money.format(totals.remaining)} remaining`}
              </p>
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-accent px-3 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong motion-reduce:transition-none"
              >
                Apply budget
              </button>
              <p className="min-h-5 text-sm text-text-muted" role="status" aria-live="polite">{budgetMessage}</p>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Camera choices live with the room stage, not the global navigation. */
export function RoomCameraControls() {
  const cameraMode = useRoomStore((state) => state.cameraMode);
  const setCameraMode = useRoomStore((state) => state.setCameraMode);

  return (
    <div className="flex rounded-control border border-border bg-surface/95 p-1" aria-label="Room camera">
      {cameras.map(({ mode, label, Icon }) => (
        <button
          key={mode}
          type="button"
          aria-label={`${label} camera`}
          aria-pressed={cameraMode === mode}
          onClick={() => setCameraMode(mode)}
          className={`inline-flex size-11 items-center justify-center rounded-control transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none ${cameraMode === mode ? 'bg-accent text-on-accent' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`}
        >
          <Icon className="size-4" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
