/**
 * Budget and pricing breakdown of a design.
 *
 * Pure, deterministic helpers over placed items and the static PRODUCTS
 * catalog. Shared by the Zustand store and the WebMCP-facing store actions.
 * Existing (pre-room) items are listed in the breakdown but never count
 * against the budget; only marketplace-sourced items contribute to newTotal.
 */

import type { PlacedFurniture, PriceItem, PriceSummary } from './types';
import { PRODUCTS } from '@/data/products';

/**
 * Full budget breakdown of the current design. One line per placed item that
 * resolves in the catalog; placed items referencing missing products are
 * skipped so they can never corrupt the totals. `remaining` is signed and
 * negative when the marketplace total exceeds the budget.
 */
export function calculateTotal(items: readonly PlacedFurniture[], budget: number): PriceSummary {
  const priceItems: PriceItem[] = [];
  let newTotal = 0;
  let existingTotal = 0;

  for (const item of items) {
    const product = PRODUCTS.find((p) => p.id === item.productId);
    if (!product) continue;
    const lineTotal = product.price; // one placed instance per line
    priceItems.push({
      instanceId: item.instanceId,
      productId: item.productId,
      name: product.name,
      category: product.category,
      unitPrice: product.price,
      quantity: 1,
      lineTotal,
      source: item.source,
      locked: item.locked,
    });
    if (item.source === 'marketplace') newTotal += lineTotal;
    else existingTotal += lineTotal;
  }

  const remaining = budget - newTotal;
  return {
    items: priceItems,
    newTotal,
    existingTotal,
    grandTotal: newTotal + existingTotal,
    budget,
    remaining,
    overBudget: newTotal > budget,
  };
}

/** Whether the design is inside, exactly at, or beyond the budget. */
export type BudgetPressureStatus = 'under_budget' | 'at_budget' | 'over_budget';

/** Budget pressure report of a design. */
export interface BudgetPressureResult {
  status: BudgetPressureStatus;
  /** budget - newTotal; negative when over budget */
  remaining: number;
  /** max(0, newTotal - budget); 0 when within budget */
  amountOver: number;
  /** marketplace items that may be replaced, most expensive first */
  replaceable: readonly PriceItem[];
}

/**
 * Budget pressure of a design: status, signed remaining, amount over, and
 * the replaceable marketplace items sorted expensive-first for budget-rescue
 * tradeoffs. Locked items cannot be replaced and existing items never count
 * against the budget, so neither is listed.
 */
export function getBudgetPressure(items: readonly PlacedFurniture[], budget: number): BudgetPressureResult {
  const summary = calculateTotal(items, budget);
  const status: BudgetPressureStatus =
    summary.newTotal > budget ? 'over_budget' : summary.newTotal < budget ? 'under_budget' : 'at_budget';
  const replaceable = summary.items
    .filter((line) => line.source === 'marketplace' && !line.locked)
    .sort((a, b) => b.unitPrice - a.unitPrice);
  return {
    status,
    remaining: summary.remaining,
    amountOver: summary.overBudget ? summary.newTotal - budget : 0,
    replaceable,
  };
}
