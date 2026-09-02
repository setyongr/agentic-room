/**
 * Contract tests for {@link findCheaperAlternatives} (src/domain/alternatives.ts).
 *
 * Scenario: the premium Budget Rescue accent chair (Aria Accent Chair,
 * `budget-rescue-chair-premium`, 310 USD) placed as an unlocked marketplace
 * item. The plan's alternative-suggestion invariants, defended over the
 * deterministic catalog:
 *   - every candidate is in stock, strictly cheaper, same-category, and
 *     dimensionally compatible with the current footprint (no axis exceeds
 *     the current product's by more than MAX_DIMENSION_GROWTH);
 *   - savings and totalSavings are exact currentPrice - alternativePrice
 *     arithmetic;
 *   - results are deterministic and ranked best-first by composite
 *     compatibility, then savings, then product id;
 *   - maxResults and targetPrice (inclusive upper bound) are respected, and
 *     a no-match run returns an ok result with an empty candidate list;
 *   - structured errors for missing / existing / locked instances and
 *     unknown products, per the documented public contract.
 */

import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/data/products';
import { findCheaperAlternatives } from '@/domain/alternatives';
import type {
  FurnitureProduct,
  PlacedFurniture,
  SerializableResult,
  SerializableSuccess,
} from '@/domain/types';

const PREMIUM_CHAIR_ID = 'budget-rescue-chair-premium';

/** A replacement may exceed the current product in no axis by more than this factor. */
const MAX_DIMENSION_GROWTH = 1.1;

/** Expected best-first candidate order: composite score, then savings, then product id. */
const EXPECTED_ORDER = [
  'sprout-accent-chair',
  'curl-accent-chair',
  'budget-rescue-chair-value',
  'pipa-accent-chair',
] as const;

const productById: Readonly<Record<string, FurnitureProduct>> = Object.fromEntries(
  PRODUCTS.map((product) => [product.id, product]),
);

function currentProduct(): FurnitureProduct {
  return productById[PREMIUM_CHAIR_ID];
}

function placedChair(overrides?: Partial<PlacedFurniture>): PlacedFurniture {
  return {
    instanceId: 'inst-aria-chair',
    productId: PREMIUM_CHAIR_ID,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    locked: false,
    source: 'marketplace',
    ...overrides,
  };
}

function expectOk<T>(result: SerializableResult<T>): SerializableSuccess<T> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected ${result.code}: ${result.message}`);
  return result;
}

function expectErrorCode(result: SerializableResult<unknown>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected a structured error');
  return result.code;
}

describe('findCheaperAlternatives', () => {
  const current = currentProduct();

  it('returns only in-stock, strictly cheaper, same-category, dimensionally compatible candidates, ranked best-first', () => {
    const { data } = expectOk(findCheaperAlternatives('inst-aria-chair', [placedChair()]));
    const { instanceId, alternatives, totalSavings } = data;

    expect(instanceId).toBe('inst-aria-chair');
    expect(alternatives.map((a) => a.alternativeProductId)).toEqual([...EXPECTED_ORDER]);

    for (const alternative of alternatives) {
      const product = productById[alternative.alternativeProductId];

      // Eligibility invariants: in stock, strictly cheaper, same category.
      expect(product.stock).toBeGreaterThan(0);
      expect(product.price).toBeLessThan(current.price);
      expect(product.category).toBe(current.category);

      // Dimensional compatibility with the current footprint/tolerances.
      expect(product.width).toBeLessThanOrEqual(current.width * MAX_DIMENSION_GROWTH);
      expect(product.depth).toBeLessThanOrEqual(current.depth * MAX_DIMENSION_GROWTH);
      expect(product.height).toBeLessThanOrEqual(current.height * MAX_DIMENSION_GROWTH);

      // Payload consistency and exact savings arithmetic.
      expect(alternative.instanceId).toBe('inst-aria-chair');
      expect(alternative.currentProductId).toBe(current.id);
      expect(alternative.currentProductName).toBe(current.name);
      expect(alternative.currentPrice).toBe(current.price);
      expect(alternative.alternativePrice).toBe(product.price);
      expect(alternative.savings).toBe(current.price - product.price);
      expect(alternative.styleCompatibility).toBeGreaterThanOrEqual(0);
      expect(alternative.styleCompatibility).toBeLessThanOrEqual(1);
      expect(alternative.dimensionCompatibility).toBeGreaterThanOrEqual(0);
      expect(alternative.dimensionCompatibility).toBeLessThanOrEqual(1);
    }

    const expectedSavings = alternatives.reduce((sum, a) => sum + a.savings, 0);
    expect(totalSavings).toBe(expectedSavings);
    expect(totalSavings).toBe(340);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const items = [placedChair()];
    const first = expectOk(findCheaperAlternatives('inst-aria-chair', items));
    const second = expectOk(findCheaperAlternatives('inst-aria-chair', items));
    expect(second.data).toEqual(first.data);
  });

  it('respects the maxResults cap', () => {
    const items = [placedChair()];

    const capped = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { maxResults: 2 }),
    );
    expect(capped.data.alternatives.map((a) => a.alternativeProductId)).toEqual(
      EXPECTED_ORDER.slice(0, 2),
    );
    expect(capped.data.totalSavings).toBe(220);

    const empty = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { maxResults: 0 }),
    );
    expect(empty.data.alternatives).toEqual([]);
    expect(empty.data.totalSavings).toBe(0);

    const uncapped = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { maxResults: 50 }),
    );
    expect(uncapped.data.alternatives.map((a) => a.alternativeProductId)).toEqual([
      ...EXPECTED_ORDER,
    ]);
    expect(uncapped.data.totalSavings).toBe(340);
  });

  it('respects targetPrice as an inclusive upper bound, with an ok no-match result', () => {
    const items = [placedChair()];

    const atBound = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { targetPrice: 220 }),
    );
    expect(atBound.data.alternatives.map((a) => a.alternativeProductId)).toEqual([
      'sprout-accent-chair',
      'curl-accent-chair',
    ]);
    expect(atBound.data.totalSavings).toBe(220);

    const mid = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { targetPrice: 200 }),
    );
    expect(mid.data.alternatives.map((a) => a.alternativeProductId)).toEqual([
      'sprout-accent-chair',
    ]);
    expect(mid.data.totalSavings).toBe(130);

    const none = expectOk(
      findCheaperAlternatives('inst-aria-chair', items, { targetPrice: 100 }),
    );
    expect(none.data.alternatives).toEqual([]);
    expect(none.data.totalSavings).toBe(0);
  });

  it('returns structured errors for missing, existing, and locked instances and unknown products', () => {
    const missing = findCheaperAlternatives('inst-unknown', [placedChair()]);
    expect(expectErrorCode(missing)).toBe('missing_instance');

    const existing = findCheaperAlternatives('inst-aria-chair', [
      placedChair({ source: 'existing' }),
    ]);
    expect(expectErrorCode(existing)).toBe('existing_instance');

    const locked = findCheaperAlternatives('inst-aria-chair', [
      placedChair({ locked: true }),
    ]);
    expect(expectErrorCode(locked)).toBe('locked_instance');

    const unknown = findCheaperAlternatives('inst-aria-chair', [
      placedChair({ productId: 'not-a-catalog-product' }),
    ]);
    expect(expectErrorCode(unknown)).toBe('missing_product');
  });
});
