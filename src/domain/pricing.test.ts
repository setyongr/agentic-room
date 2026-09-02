import { describe, expect, it } from 'vitest';
import { calculateTotal, getBudgetPressure } from '@/domain/pricing';
import { placeProduct, replaceProduct } from '@/domain/placement';
import { BUDGET_RESCUE_ITEMS, DEFAULT_ROOM, DEFAULT_ROOM_ITEMS } from '@/data/demoRoom';
import type { PlacedFurniture } from '@/domain/types';

/**
 * Place a marketplace product through the exported placement action.
 * Explicit x/z placement is unvalidated beyond product existence and stock.
 */
function placeMarketplace(productId: string, x: number, z: number): PlacedFurniture {
  const result = placeProduct(productId, DEFAULT_ROOM, [], { x, z, source: 'marketplace' });
  if (!result.ok) throw new Error(`fixture placement failed: ${result.code}`);
  return result.data.item;
}

describe('calculateTotal', () => {
  it('counts nothing against the budget for an existing-only design', () => {
    const summary = calculateTotal(DEFAULT_ROOM_ITEMS, 700);
    expect(summary.newTotal).toBe(0);
    expect(summary.existingTotal).toBe(1710);
    expect(summary.grandTotal).toBe(1710);
    expect(summary.budget).toBe(700);
    expect(summary.remaining).toBe(700);
    expect(summary.overBudget).toBe(false);
    expect(summary.items).toHaveLength(3);
    const byInstance = new Map(summary.items.map((line) => [line.instanceId, line]));
    expect(byInstance.get('existing-sofa')?.unitPrice).toBe(760);
    expect(byInstance.get('existing-rug')?.unitPrice).toBe(640);
    expect(byInstance.get('existing-console')?.unitPrice).toBe(310);
    for (const line of summary.items) {
      expect(line.source).toBe('existing');
      expect(line.quantity).toBe(1);
      expect(line.lineTotal).toBe(line.unitPrice);
    }
  });

  it('charges marketplace items at current catalog prices while existing items stay free', () => {
    const table = placeMarketplace('budget-rescue-table-premium', 0, -0.45);
    const lamp = placeMarketplace('budget-rescue-lamp-premium', 1.75, -1.5);
    const items = [...DEFAULT_ROOM_ITEMS, table, lamp];
    const summary = calculateTotal(items, 700);
    expect(summary.newTotal).toBe(560);
    expect(summary.existingTotal).toBe(1710);
    expect(summary.grandTotal).toBe(2270);
    expect(summary.remaining).toBe(140);
    expect(summary.overBudget).toBe(false);
    const marketLines = summary.items.filter((line) => line.source === 'marketplace');
    expect(marketLines).toHaveLength(2);
    const byProduct = new Map(marketLines.map((line) => [line.productId, line.unitPrice]));
    expect(byProduct.get('budget-rescue-table-premium')).toBe(340);
    expect(byProduct.get('budget-rescue-lamp-premium')).toBe(220);
  });

  it('skips placed items whose product is missing from the catalog', () => {
    const table = placeMarketplace('budget-rescue-table-premium', 0, -0.45);
    const ghost: PlacedFurniture = {
      instanceId: 'ghost-item',
      productId: 'not-in-catalog',
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      locked: false,
      source: 'marketplace',
      variant: { color: 'ghost', material: 'unknown' },
    };
    const summary = calculateTotal([...DEFAULT_ROOM_ITEMS, table, ghost], 700);
    expect(summary.items.some((line) => line.productId === 'not-in-catalog')).toBe(false);
    expect(summary.newTotal).toBe(340);
    expect(summary.existingTotal).toBe(1710);
  });
});

describe('budget pressure', () => {
  it('reports signed remaining and overage when the marketplace total exceeds the budget', () => {
    const summary = calculateTotal(BUDGET_RESCUE_ITEMS, 1000);
    expect(summary.newTotal).toBe(1140);
    expect(summary.remaining).toBe(-140);
    expect(summary.overBudget).toBe(true);

    const pressure = getBudgetPressure(BUDGET_RESCUE_ITEMS, 1000);
    expect(pressure.status).toBe('over_budget');
    expect(pressure.remaining).toBe(-140);
    expect(pressure.amountOver).toBe(140);
    // Only marketplace lines are replaceable, most expensive first; locked
    // existing items never appear.
    expect(pressure.replaceable.map((line) => line.productId)).toEqual([
      'budget-rescue-table-premium',
      'budget-rescue-chair-premium',
      'budget-rescue-shelf-premium',
      'budget-rescue-lamp-premium',
    ]);
  });

  it('reaches at_budget exactly when marketplace spend equals the budget', () => {
    const table = placeMarketplace('budget-rescue-table-premium', 0, -0.45);
    const lamp = placeMarketplace('budget-rescue-lamp-premium', 1.75, -1.5);
    // Existing items must not push an at-budget design over.
    const items = [...DEFAULT_ROOM_ITEMS, table, lamp];
    const pressure = getBudgetPressure(items, 560);
    expect(pressure.status).toBe('at_budget');
    expect(pressure.remaining).toBe(0);
    expect(pressure.amountOver).toBe(0);
    expect(calculateTotal(items, 560).overBudget).toBe(false);
  });
});

describe('replacement recalculation', () => {
  it('keeps the placement, reports savings, and reprices the total', () => {
    const items: readonly PlacedFurniture[] = [...BUDGET_RESCUE_ITEMS];
    const result = replaceProduct('rescue-coffee-table', items, 'budget-rescue-table-value');
    if (!result.ok) throw new Error(`expected replacement to succeed, got ${result.code}`);
    const { item, savings, items: updated } = result.data;

    // Placement-preserving replacement: identity, position, rotation, source.
    expect(item.instanceId).toBe('rescue-coffee-table');
    expect(item.productId).toBe('budget-rescue-table-value');
    expect(item.position).toEqual({ x: 0, y: 0, z: -0.45 });
    expect(item.rotation).toBe(0);
    expect(item.source).toBe('marketplace');
    expect(item.locked).toBe(false);

    // Current catalog price (340) minus replacement price (175).
    expect(savings).toBe(165);

    // The caller-owned input is untouched.
    expect(items.map((entry) => entry.productId)).toEqual(
      BUDGET_RESCUE_ITEMS.map((entry) => entry.productId),
    );

    // Recalculated total reflects the new price: 1140 - 340 + 175 = 975.
    const summary = calculateTotal(updated, 1000);
    expect(summary.newTotal).toBe(975);
    expect(summary.remaining).toBe(25);
    expect(summary.overBudget).toBe(false);
    const line = summary.items.find((entry) => entry.instanceId === 'rescue-coffee-table');
    expect(line?.name).toBe('Nook Coffee Table');
    expect(line?.unitPrice).toBe(175);
    expect(line?.lineTotal).toBe(175);
  });
});
