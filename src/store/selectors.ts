/**
 * Focused selectors over the room store.
 *
 * Every selector returns a stable value (a primitive, a live state slice,
 * or a memoized slice), so the selectors can be passed directly to the
 * `useRoomStore` hook (`useRoomStore(selectSelectedItem)`) without
 * re-render loops, and equally well to `useRoomStore.getState()` for
 * imperative/WebMCP use.
 *
 * Selectors stay thin: derived numbers route through the domain functions
 * (`getBudgetPressure`, `getProductById`) instead of reimplementing them.
 */

import { getBudgetPressure } from '@/domain/pricing';
import type { BudgetPressureStatus } from '@/domain/pricing';
import { getProductById } from '@/domain/catalog';
import type {
  ActivityEntry,
  FurnitureProduct,
  PlacedFurniture,
  ValidationIssue,
} from '@/domain/types';
import type { RoomStore } from './roomStore';

/** Number of newest activity entries `selectRecentActivity` returns by default. */
export const RECENT_ACTIVITY_LIMIT = 5;

/** The currently selected placed instance, or undefined when none is selected. */
export function selectSelectedItem(state: RoomStore): PlacedFurniture | undefined {
  return state.selectedInstanceId === null
    ? undefined
    : state.furniture.find((item) => item.instanceId === state.selectedInstanceId);
}

/** The catalog product of the currently selected instance, if any. */
export function selectSelectedProduct(state: RoomStore): FurnitureProduct | undefined {
  const item = selectSelectedItem(state);
  return item === undefined ? undefined : getProductById(item.productId);
}

/**
 * Live price summary of the current design (new/existing/grand totals,
 * remaining, budget). Returns the store's live slice, so the reference is
 * stable between mutations.
 */
export function selectTotals(state: RoomStore): RoomStore['pricing'] {
  return state.pricing;
}

/** Budget pressure status of the current design, via the domain report. */
export function selectBudgetStatus(state: RoomStore): BudgetPressureStatus {
  return getBudgetPressure(state.furniture, state.budget).status;
}

/** Validation issues of the current design; stable until the next mutation. */
export function selectValidationIssues(state: RoomStore): readonly ValidationIssue[] {
  return state.validation.issues;
}

/** Whether the current design has no error-severity validation issue. */
export function selectValidationValid(state: RoomStore): boolean {
  return state.validation.valid;
}

/** Sum of every cart line's unit price x quantity. */
export function selectCartTotal(state: RoomStore): number {
  return state.cart.total;
}

/** Total number of cart line units (quantities summed). */
export function selectCartCount(state: RoomStore): number {
  let count = 0;
  for (const line of state.cart.items) {
    count += line.quantity;
  }
  return count;
}

const EMPTY_ACTIVITY: readonly ActivityEntry[] = [];

/**
 * Memoized newest-first view of the feed: the `limit` newest entries, cached
 * per feed reference so the selector result is stable between appends.
 * Custom limits are computed fresh (wrap in `useShallow` if used with the
 * hook).
 */
const recentActivityCache = new WeakMap<readonly ActivityEntry[], readonly ActivityEntry[]>();

export function selectRecentActivity(
  state: RoomStore,
  limit: number = RECENT_ACTIVITY_LIMIT,
): readonly ActivityEntry[] {
  if (limit <= 0) {
    return EMPTY_ACTIVITY;
  }
  if (limit === RECENT_ACTIVITY_LIMIT) {
    let cached = recentActivityCache.get(state.activity);
    if (cached === undefined) {
      cached = state.activity.slice(-limit);
      recentActivityCache.set(state.activity, cached);
    }
    return cached;
  }
  return state.activity.slice(-limit);
}
